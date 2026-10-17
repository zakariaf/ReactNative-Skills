#!/usr/bin/env node
// check-skill.mjs: the completeness checks for a skill that validate-skill.mjs does not make (the
// validator proves the structure; this proves the content is finished and usable): description
// boundaries, a reason for every rule, every file used, filled placeholders, real hand-offs,
// self-test coverage, rule ids in EXPECT files, templates that name their repo path, SKIP lines in
// the definition of done, documented contracts, and no deprecated or outdated helper calls.
//   node ${CLAUDE_SKILL_DIR}/scripts/check-skill.mjs skills/<name>
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import { createReporter, fail, isBinary, maskComments, parseArgs, run, toPosix, walk } from './check-lib.mjs';
import { STANDARD_PATH, loadStandard } from './lib/skill-standard.mjs';
import { NAME_PATTERN, judgedSkills, notForNames, nothingToJudge, proseOnly, readSkill, repoSkillRoots, resolveSkillPath, skillNamesIn } from './lib/skill-md.mjs';

const SPEC = {
  name: 'check-skill',
  summary: 'Checks that a skill is finished (a repo root: its authored skills; installed ones under .agents/skills are their authors\' and only noted, and a repo with only installed skills is NOT APPLICABLE): description boundaries, a reason for every rule, every reference and script used in the workflow, filled placeholders, Files table "when" cells, real related skills, self-test coverage, rule ids in EXPECT files, template path headers, SKIP lines in the definition of done, documented contracts and no deprecated helpers. A path is a skill folder, a skills folder or a repo root.',
  usage: '[path...] [options]',
  options: {
    'skills-root': { type: 'string', multiple: true, value: 'dir', help: 'Folder of skills that hand-offs may name (default: the folders holding the checked skills, plus the skills/, .claude/skills/ and .agents/skills/ of their repo)' },
    standard: { type: 'string', value: 'file', help: 'Standard file whose reserved names count as known hand-offs (default: assets/standard.json of this skill)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'Rules:',
    '  desc-not-for          the description names its neighbours: "Not for <work> (<skill>)"',
    '  desc-neighbours       every skill named in the "Not for" parentheses exists (or is a bundled or Expo skill)',
    '  rule-why              every rule is a bold statement followed by its reason (at least 4 more words)',
    '  workflow-mentions     every reference, example and script is named in the body, not only in the Files table',
    '  files-when            every Files table row says when to read or run the file',
    '  related-names         every Related skills item starts with an existing skill name in backticks, or with "Expo\'s [official] `<name>`" when every name before its " - " is an Expo skill',
    '  placeholder-left      no placeholder is left in SKILL.md, references/ or examples/ prose, and no __FILL_...__ in scripts/',
    '  template-markers      templates hold no TODO/FIXME/XXX and no mixed-case double-underscore placeholders',
    '  template-path-header  a code or YAML template names its repo path on line 1 (// src/... or # .maestro/...), with its own extension',
    '  selftest-covers       scripts/selftest.mjs runs every checker in scripts/',
    '  expect-rule-id        every bad-* EXPECT.txt names a rule id: a line that is the id, or [rule-id] in a line',
    '  rule-has-bad-case     every rule id a checker lists under "Rules:" in its --help appears in a bad-* EXPECT.txt of that checker\'s own suites (from scripts/selftest.mjs; one planted bug per rule)',
    '  dod-skips             a skill whose scripts print SKIP lines lists them in its Definition of done: each rule id passed to report.skip({ rule: \'<id>\' }) on a line that says SKIP',
    '  contract-documented   every contracts/<name>.json a script reads ships in the skill (templates/, assets/, examples/) or is named in SKILL.md or a reference',
    '  deprecated-api        no script uses a check-lib export marked @deprecated',
    '  repo-scan-walk        a repo scan uses walkRepo(), never walk() with REPO_SCAN_IGNORES or a constant built from it (a deliberately wider scan says "repo-scan-walk: deliberate" in a comment on the line or the line above)',
    '',
    'Run validate-skill.mjs first; this checker assumes its structure. rule-has-bad-case runs each checker with --help (30 s limit).',
    'These are heuristics over the source: a pointer to a repo document in prose, a skip whose rule is not a literal and a scan',
    'built some other way stay review items (the authoring-standard reference lists them). A skip whose file is derived or',
    'imported (not a literal or a same-file literal constant) is matched by any DoD SKIP item that names its rule id or a',
    'path written as a string literal in the skill\'s scripts.',
  ].join('\n'),
};

// Placeholder tokens that the standard itself uses as examples of the convention, and real globals that
// look like placeholders (React Native's __DEV__).
const EXAMPLE_TOKENS = new Set(['__UPPER_SNAKE__', '__PLACEHOLDER__', '__DEV__']);
// A placeholder standing alone in prose (one inside a path such as templates/__FEATURE__/x.ts is a real path).
const PLACEHOLDER = /(?<![\w/.-])__[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*?__(?![\w/.-])/g;
// Scaffold placeholders in scripts start with FILL_ (scripts that check templates may name others).
const FILL_PLACEHOLDER = /__FILL_[A-Z0-9]+(?:_[A-Z0-9]+)*?__/g;
const ANY_PLACEHOLDER = /__([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*?)__/g;
// TODO and FIXME anywhere; XXX only where a comment starts with it (XXX is also the ISO 4217 "no currency" code).
const MARKERS = /\b(TODO|FIXME)\b|(?:\/\/|\/\*|^\s*\*|^\s*#)\s*(XXX)\b/m;
const HELPERS = new Set(['check-lib.mjs', 'selftest.mjs']);
const SLASH_HEADER = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const HASH_HEADER = new Set(['.yaml', '.yml', '.sh', '.toml']);

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Exports of a check-lib copy whose JSDoc says @deprecated: Map(name -> advice). */
function deprecatedExports(checkLibSource) {
  const found = new Map();
  for (const match of checkLibSource.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    const at = /@deprecated\s*([^\n]*)/.exec(match[1]);
    if (at) found.set(match[2], at[1].replace(/\*\/?\s*$/, '').trim());
  }
  return found;
}

/** Problem with the repo path a template names on line 1 (after a shebang for # files), or null. Same reading as the library's template verifier. */
function headerProblem(rel, text) {
  const ext = rel.endsWith('.d.ts') ? '.ts' : extname(rel);
  const lines = text.split('\n');
  const slash = SLASH_HEADER.has(ext);
  const first = (slash || !(lines[0] ?? '').startsWith('#!') ? lines[0] : lines[1]) ?? '';
  const match = slash ? /^\/\/\s*(\S+)/.exec(first) : /^#\s*(\S+)/.exec(first);
  if (!match) return `line ${slash || !(lines[0] ?? '').startsWith('#!') ? 1 : 2} is "${first.slice(0, 60)}", not "${slash ? '//' : '#'} <repo path>"`;
  const path = match[1].replace(/[:;,]+$/, '').replace(/^\.\//, '');
  if (path.startsWith('/') || path.split('/').includes('..')) return `line 1 names "${path}", which is not a repo-relative path`;
  const named = path.endsWith('.d.ts') ? '.ts' : extname(path);
  if (named !== ext) return `line 1 names "${path}", but the template is a ${ext} file`;
  return null;
}

/**
 * Index just past the string literal that starts at `at` (quote, double quote or backtick; escapes
 * skipped). A quote or double quote string ends at the line end at the latest, so a quote inside a
 * regex literal costs one line at most.
 */
function skipString(code, at) {
  const quote = code[at];
  let i = at + 1;
  while (i < code.length && code[i] !== quote) {
    if (quote !== '`' && code[i] === '\n') return i;
    i += code[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

/** The text between the bracket at `open` and its partner, any depth, skipping strings; null when unbalanced. */
function balancedText(code, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < code.length; ) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(code, i);
      continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return code.slice(open + 1, i);
    }
    i += 1;
  }
  return null;
}

/** The initializer of a declaration that starts at `from`: up to the first ; or line end outside brackets and strings. */
function initializerText(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; ) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(code, i);
      continue;
    }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (depth <= 0 && (ch === ';' || ch === '\n')) return code.slice(from, i);
    i += 1;
  }
  return code.slice(from);
}

// The scan ignores without the SKILL.md pruning, and the marker that keeps a deliberately wider scan.
const SCAN_IGNORE_SEEDS = ['REPO_SCAN_IGNORES', 'repoScanIgnores'];
const DELIBERATE_SCAN = /repo-scan-walk:\s*deliberate/;

/**
 * walk( calls that receive the repo-scan ignores, directly or through constants built from them
 * (const IGNORE = [...REPO_SCAN_IGNORES, ...]; const OPTIONS = { ignore: IGNORE }), at any nesting
 * depth. A call whose line, or the line above, holds "repo-scan-walk: deliberate" is kept.
 * Returns [{ index, via }] over the comment-masked source.
 */
function repoScanWalks(code, raw) {
  const tainted = new Set(SCAN_IGNORE_SEEDS);
  const mentions = (text) => [...tainted].find((name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text));
  const declarations = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((match) => ({ name: match[1], init: initializerText(code, match.index + match[0].length) }));
  for (let grew = true; grew; ) {
    grew = false;
    for (const { name, init } of declarations) {
      if (!tainted.has(name) && mentions(init)) {
        tainted.add(name);
        grew = true;
      }
    }
  }
  const rawLines = raw.split('\n');
  const found = [];
  for (const match of code.matchAll(/(?<![\w$.])walk\s*\(/g)) {
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, match.index - 20), match.index))) continue;
    const args = balancedText(code, match.index + match[0].length - 1);
    const via = args === null ? undefined : mentions(args);
    if (!via) continue;
    const line = lineAt(code, match.index);
    if (DELIBERATE_SCAN.test(rawLines[line - 1] ?? '') || DELIBERATE_SCAN.test(rawLines[line - 2] ?? '')) continue;
    found.push({ index: match.index, via });
  }
  return found;
}

/**
 * The SKIP lines a script can print, from its report.skip({ rule: '<id>', file: '<path>' }) calls:
 * { skips: [{ id, file }], dynamic } where dynamic means a skip names its rule some other way (a
 * variable). A ship gate's --rehearsal skip is left out: a passing release run never prints it.
 */
function skipCalls(code) {
  const skips = [];
  let dynamic = false;
  for (const match of code.matchAll(/\.skip\s*\((?=\s*\{)/g)) {
    const args = balancedText(code, match.index + match[0].length - 1) ?? '';
    if (/rehearsal/i.test(args)) continue;
    const literal = /\brule\s*:\s*(['"`])([a-z0-9]+(?:-[a-z0-9]+)*)\1/.exec(args);
    // The file: a literal, or a constant declared with a literal (const CATALOG = 'src/i18n/catalogs/en.json').
    const file = /\bfile\s*:\s*(?:(['"`])([^'"`$]+)\1|([A-Za-z_$][\w$]*)\s*[,}])/.exec(args);
    const constant = file?.[3] ? new RegExp(`\\bconst\\s+${file[3].replace(/\$/g, '\\$')}\\s*=\\s*(['"\`])([^'"\`$]+)\\1`).exec(code) : null;
    // A file that is neither a literal nor a same-file literal constant (derived, imported) is unresolved.
    const resolved = file?.[2] ?? constant?.[2] ?? null;
    if (literal) skips.push({ id: literal[2], file: resolved, unresolvedFile: resolved === null && /\bfile\b/.test(args) });
    else dynamic = true;
  }
  return { skips, dynamic };
}

/**
 * Fixture suites each script of a skill is tested by, read from scripts/selftest.mjs: Map(script
 * basename -> [suite folders relative to the skill]). Only literal { script: '...', fixtures: '...' }
 * entries count; a script with none falls back to every bad-* case of the skill.
 */
function suitesByScript(selftest) {
  const suites = new Map();
  const entries = [...selftest.matchAll(/\bscript\s*:\s*(['"`])([^'"`]+)\1/g)];
  entries.forEach((entry, i) => {
    const until = entries[i + 1]?.index ?? selftest.length;
    const fixtures = /\bfixtures\s*:\s*(['"`])([^'"`]+)\1/.exec(selftest.slice(entry.index, until));
    if (!fixtures || fixtures[2].startsWith('/')) return;
    const suite = toPosix(join('scripts', fixtures[2])).replace(/\/$/, '');
    if (suite.startsWith('..')) return;
    const name = basename(entry[2]);
    suites.set(name, [...(suites.get(name) ?? []), suite]);
  });
  return suites;
}

function checkSkill(dir, known, expoSkills, report) {
  const skill = readSkill(dir);
  const name = basename(dir);
  if (!skill) fail(`nothing to check: ${dir} has no SKILL.md`, 'Pass a skill folder (skills/<name>).');
  const add = (file, line, rule, message, fix) => report.problem({ file: `${name}/${file}`, line, rule, message, fix });
  const canCheckNames = known.size >= 2;
  const files = walk(dir, { defaultIgnores: false, ignore: ['node_modules', '.git', '.DS_Store'] });
  const description = skill.frontmatter.description ?? '';
  const read = (rel) => readFileSync(join(dir, rel), 'utf8');
  const entryScripts = files.filter((rel) => /^scripts\/[^/]+\.mjs$/.test(rel) && !HELPERS.has(basename(rel)));
  const scriptSources = files.filter((rel) => rel.startsWith('scripts/') && rel.endsWith('.mjs') && basename(rel) !== 'check-lib.mjs').map((rel) => ({ rel, code: maskComments(read(rel)) }));

  // ---- description ----
  if (!/\bNot for\b/.test(description)) add('SKILL.md', 3, 'desc-not-for', 'the description has no "Not for" boundary', 'End it with "Not for <neighbouring work> (<skill-name>)." so the agent can tell this skill from its neighbours.');
  if (canCheckNames) {
    for (const other of notForNames(description)) {
      if (!known.has(other)) add('SKILL.md', 3, 'desc-neighbours', `"Not for" names ${other}, which is not a known skill`, 'Name an existing skill, or describe the work without a skill name.');
    }
  }

  // ---- rules ----
  for (const rule of skill.rules) {
    const plain = rule.text.replace(/(`+)([\s\S]*?)\1/g, 'code');
    const bold = /\*\*([^*]+)\*\*/.exec(plain);
    const after = bold ? plain.slice(bold.index + bold[0].length).trim() : '';
    if (!bold) add('SKILL.md', rule.line, 'rule-why', 'the rule has no **bold statement**', 'Write "N. **The rule.** Why it matters." so the rule survives skimming and compaction.');
    else if (after.split(/\s+/).filter(Boolean).length < 4) add('SKILL.md', rule.line, 'rule-why', `the rule "${bold[1].slice(0, 50)}" has no reason after it`, 'Add the why in one sentence: what breaks when the rule is ignored.');
  }

  // ---- workflow mentions ----
  const usage = [...skill.sections.keys()].filter((title) => title !== 'Files in this skill').map((title) => skill.sectionText(title)).join('\n');
  const delegatesToTable = /Files table/.test(skill.sectionText('Workflow'));
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ancestors = (rel) => rel.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/')).filter((path) => path.includes('/'));
  const mentioned = (rel) => usage.includes(rel) || new RegExp(`(^|[^\\w./-])${escape(basename(rel))}(?![\\w-])`).test(usage) || ancestors(rel).some((folder) => new RegExp(`${escape(folder)}(/|(?![\\w-]))`).test(usage));
  const mentionsExamples = /(^|[^\w-])examples\//.test(usage);
  const mustMention = files.filter((rel) => /^references\/[^/]+\.md$/.test(rel) || /^examples\//.test(rel) || (/^scripts\/[^/]+\.mjs$/.test(rel) && !HELPERS.has(basename(rel))));
  for (const rel of mustMention) {
    if (rel.startsWith('examples/') && mentionsExamples) continue;
    if (rel.startsWith('references/') && delegatesToTable && skill.files.some((row) => row.path === rel && row.when.trim() !== '')) continue;
    if (!mentioned(rel)) add('SKILL.md', skill.sections.get('Workflow')?.line ?? 0, 'workflow-mentions', `${rel} is named only in the Files table`, `Say in a workflow step when to ${rel.startsWith('scripts/') ? 'run' : 'read'} ${rel}; a file the agent is never told to use is dead weight.`);
  }

  // ---- Files table ----
  for (const row of skill.files) {
    if (row.cellCount < 3 || row.when.replace(/[-*_`\s]/g, '') === '') add('SKILL.md', row.line, 'files-when', `the row for ${row.path || '(empty)'} does not say when to read or run it`, 'Fill the "Read/run when" cell ("Workflow step 3", "Never by hand", "When adding a rule").');
  }

  // ---- related skills ----
  for (const item of skill.related) {
    if (/^none\b/i.test(item.text.trim())) continue;
    // An Expo hand-off may lead with "Expo's [official] `<name>` ... skill(s)", but only when every
    // backticked name before the first " - " is one of Expo's skills (the reserved expo-/eas- names).
    // Only skill-shaped tokens count: a repo path such as `expo/skills` in the lead is not a name.
    const expoLead = /^Expo['’]s\s+(?:official\s+)?(?=`)/.exec(item.text.trim());
    if (expoLead) {
      const lead = item.text.trim().slice(expoLead[0].length).split(/\s+-\s+/)[0];
      const named = [...lead.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((token) => NAME_PATTERN.test(token));
      const foreign = named.filter((other) => !expoSkills.has(other));
      if (foreign.length > 0) add('SKILL.md', item.line, 'related-names', `"${item.text.slice(0, 40)}" leads with "Expo's" but names ${foreign.join(', ')}, which ${foreign.length === 1 ? 'is not an Expo skill' : 'are not Expo skills'}`, 'Keep the "Expo\'s `<name>` skill" lead for Expo\'s official skills only; write other hand-offs as "- `skill-name` - when to hand off".');
      continue;
    }
    const match = /^`([^`]+)`/.exec(item.text.trim());
    if (!match || !NAME_PATTERN.test(match[1])) add('SKILL.md', item.line, 'related-names', `"${item.text.slice(0, 40)}" does not start with a skill name in backticks`, 'Write "- `skill-name` - when to hand off" (names only, never paths), or "- Expo\'s `<expo-skill>` skill - ..." for one of Expo\'s official skills.');
    else if (match[1] === name) add('SKILL.md', item.line, 'related-names', 'the skill lists itself as related', 'Remove the row.');
    else if (canCheckNames && !known.has(match[1])) add('SKILL.md', item.line, 'related-names', `${match[1]} is not a known skill`, 'Fix the name, or remove the row until that skill exists.');
  }

  // ---- placeholders, markers and template headers ----
  for (const rel of files) {
    const prose = rel === 'SKILL.md' || /^(references|examples)\//.test(rel);
    if (!rel.startsWith('templates/') && !prose && !rel.startsWith('scripts/')) continue;
    if (basename(rel) === 'check-lib.mjs') continue;
    const buffer = readFileSync(join(dir, rel));
    if (isBinary(buffer)) continue;
    const text = buffer.toString('utf8');
    if (rel.startsWith('templates/')) {
      const marker = MARKERS.exec(text) ?? [...text.matchAll(ANY_PLACEHOLDER)].find((match) => /[A-Z]/.test(match[1]) && /[a-z]/.test(match[1]));
      if (marker) add(rel, lineAt(text, marker.index), 'template-markers', `template holds "${marker[0]}"`, 'Finish the template: placeholders are upper-snake between double underscores; no TODO, FIXME or XXX.');
      if (SLASH_HEADER.has(extname(rel)) || HASH_HEADER.has(extname(rel))) {
        const problem = headerProblem(rel, text);
        if (problem) add(rel, 1, 'template-path-header', problem, `Start the template with the repo path it is copied to, for example ${SLASH_HEADER.has(extname(rel)) ? '// src/features/tasks/task-title.ts' : '# .maestro/flows/smoke.yaml'}: tools place it by that line and readers find it.`);
      }
      continue;
    }
    // Markdown: prose only (a placeholder named inside backticks is documentation); SKILL.md also
    // keeps its frontmatter. Scripts: only the scaffold's FILL_ placeholders.
    const isMd = rel.endsWith('.md');
    const scanned = rel === 'SKILL.md' ? `${text.split('\n').slice(0, 4).join('\n')}\n${proseOnly(text.split('\n').slice(4).join('\n'))}` : isMd ? proseOnly(text) : text;
    const pattern = isMd ? PLACEHOLDER : FILL_PLACEHOLDER;
    if (!isMd && !rel.startsWith('scripts/')) continue;
    for (const match of scanned.matchAll(pattern)) {
      if (EXAMPLE_TOKENS.has(match[0])) continue;
      add(rel, lineAt(scanned, match.index), 'placeholder-left', `placeholder ${match[0]} was never filled in`, 'Replace it with the real content (scaffolded skills start full of placeholders).');
      break;
    }
  }

  // ---- self-test coverage ----
  const selftestPath = join(dir, 'scripts', 'selftest.mjs');
  if (existsSync(selftestPath)) {
    const selftest = readFileSync(selftestPath, 'utf8');
    for (const rel of entryScripts) {
      if (!selftest.includes(basename(rel))) add('scripts/selftest.mjs', 0, 'selftest-covers', `${basename(rel)} is not run by the self-test`, 'Add a suite { script, fixtures, args } with a good and at least one bad-* fixture for it.');
    }
  }

  // ---- EXPECT files (a case that lives only in its suite's CASES.json carries its EXPECT.txt lines as "expect") ----
  const inlineExpect = new Map();
  for (const rel of files.filter((path) => /^tests\/(?:.+\/)?CASES\.json$/.test(path))) {
    let data = null;
    try {
      data = JSON.parse(read(rel));
    } catch {
      continue; // validate-skills reports a broken CASES.json
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    for (const [name, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.expect === undefined) continue;
      const text = Array.isArray(entry.expect) ? entry.expect.join('\n') : String(entry.expect);
      inlineExpect.set(`${rel.slice(0, -'CASES.json'.length)}${name}/EXPECT.txt`, text);
    }
  }
  const expectFiles = [...files, ...inlineExpect.keys()];
  const readExpect = (rel) => inlineExpect.get(rel) ?? read(rel);
  for (const rel of expectFiles.filter((path) => /^tests\/fixtures\/(?:[^/]+\/)?bad-[^/]+\/EXPECT\.txt$/.test(path))) {
    const lines = readExpect(rel).split('\n').map((line) => line.trim());
    const ruleLike = (line) => /^\[?[a-z0-9]+(?:-[a-z0-9]+)*\]?$/.test(line) || /\[[a-z0-9]+\]/.test(line) || /\[[^\]]*\b[a-z0-9]+(?:-[a-z0-9]+)+\b[^\]]*\]/.test(line);
    if (!lines.some(ruleLike)) add(rel, 1, 'expect-rule-id', 'names no rule id, so the fixture passes on any failure', 'Add the rule id the planted bug must trigger, as "[rule-id]" or on its own line.');
  }

  // ---- one planted bug per rule: every rule a checker lists under "Rules:" in --help has a bad case in its own suites ----
  const badExpect = (rel) => /^tests\/(?:.+\/)?bad-[^/]+\/EXPECT\.txt$/.test(rel);
  const suites = existsSync(selftestPath) ? suitesByScript(maskComments(readFileSync(selftestPath, 'utf8'))) : new Map();
  const pooled = expectFiles.filter(badExpect).map((rel) => readExpect(rel)).join('\n');
  for (const rel of entryScripts) {
    const help = spawnSync(process.execPath, [join(dir, rel), '--help'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    const block = /(?:^|\n)Rules:\n([\s\S]*?)(?:\n\s*\n|$)/.exec(help.status === 0 ? help.stdout : '');
    if (!block) continue;
    // A rule id two checkers share (name-format in a generator and in a validator) needs a case in each checker's own suites.
    const own = suites.get(basename(rel));
    const badExpects = own ? expectFiles.filter((path) => badExpect(path) && own.some((suite) => path.startsWith(`${suite}/bad-`) && path.slice(suite.length + 1).split('/').length === 2)).map((path) => readExpect(path)).join('\n') : pooled;
    const where = own ? `the self-test suites of ${basename(rel)} (${own.join(', ')})` : 'any suite';
    for (const [, id] of block[1].matchAll(/^ {2}([a-z0-9]+(?:-[a-z0-9]+)*)\s{2,}/gm)) {
      // Only "[id]" in a line, or a line that is the id alone, counts (as in expect-rule-id): a bare word
      // would let a path such as src/layout/x.ts:3 stand in for a rule named layout.
      if (!new RegExp(`\\[${id}\\]|^[ \\t]*${id}[ \\t]*$`, 'm').test(badExpects)) add(rel, 0, 'rule-has-bad-case', `rule ${id} (listed in --help) has no bad-* case in ${where} whose EXPECT.txt names it`, `Add a bad-<case>/ to ${own ? own[0] : 'tests/fixtures/<suite>'} that plants one ${id} bug, with "[${id}]" and the planted file:line in its EXPECT.txt: a rule that has only ever passed proves nothing.`);
    }
  }

  // ---- SKIP lines belong in the definition of done: each skip on a DoD item that says SKIP ----
  const dodLine = skill.sections.get('Definition of done')?.line ?? 0;
  // One entry per checklist item or paragraph, with its wrapped continuation lines joined.
  const skipItems = skill.sectionText('Definition of done').split(/\n(?=\s*-\s|\s*$)/).filter((item) => /\bSKIP/.test(item));
  const names = (item, word) => new RegExp(`(^|[^\\w./-])${escape(word)}([^\\w-]|$)`).test(item);
  const literalPaths = [...new Set(scriptSources.filter((source) => !source.rel.endsWith('/selftest.mjs')).flatMap(({ code }) => [...code.matchAll(/(['"`])([\w@.-]+(?:\/[\w@.*-]+)*\.[a-z]{1,5})\1/g)].map((m) => m[2])))];
  for (const { rel, code } of scriptSources.filter((source) => !source.rel.endsWith('/selftest.mjs'))) {
    const { skips, dynamic } = skipCalls(code);
    if (!dynamic && skips.length === 0 && !/\bnotYetCreated\s*\(/.test(code)) continue;
    if (skipItems.length === 0) {
      add('SKILL.md', dodLine, 'dod-skips', `${rel} prints SKIP lines, but the Definition of done lists none`, 'List every SKIP line a passing run may print (for example "SKIP src/i18n/catalogs/en.json [catalog-key] not yet created (i18n-strings-and-catalogs creates it)"), so a reader knows which SKIP is expected and which is a gap.');
      continue;
    }
    const reportedIds = new Set();
    // When a skip's file cannot be resolved from the source, a DoD SKIP item that names any repo path
    // (or its basename) written as a string literal in the skill's scripts stands in for it.
    const namesLiteralPath = (item) => literalPaths.some((path) => item.includes(path) || names(item, basename(path)));
    for (const { id, file, unresolvedFile } of skips) {
      if (reportedIds.has(id) || skipItems.some((item) => names(item, id) || (file && (item.includes(file) || names(item, basename(file)))) || (unresolvedFile && namesLiteralPath(item)))) continue;
      reportedIds.add(id);
      add('SKILL.md', dodLine, 'dod-skips', `${rel} can print SKIP [${id}], but no Definition of done item that says SKIP names ${id}`, `Add that SKIP line ("SKIP <file> [${id}] not yet created (<owner> creates it)") to the Definition of done, so a reader knows it is expected.`);
    }
  }

  // ---- contracts a script reads ----
  const skillText = [skill.text, ...files.filter((rel) => /^references\/.+\.md$/.test(rel)).map((rel) => read(rel))].join('\n');
  const shipped = new Set(files.filter((rel) => /^(templates|assets|examples)\//.test(rel)).map((rel) => basename(rel)));
  const reported = new Set();
  for (const { rel } of scriptSources) {
    const raw = read(rel);
    const names = [...raw.matchAll(/contracts\/([a-z0-9][a-z0-9.-]*\.json)\b/g), ...raw.matchAll(/contractsDir\s*,\s*['"`]([a-z0-9][a-z0-9.-]*\.json)['"`]/g)].map((match) => ({ file: match[1], index: match.index }));
    for (const { file, index } of names) {
      if (reported.has(file) || shipped.has(file) || skillText.includes(file)) continue;
      reported.add(file);
      add(rel, lineAt(raw, index), 'contract-documented', `reads contracts/${file}, which the skill neither ships nor names in SKILL.md`, `Ship templates/contracts/${file} (and its schema) when this skill owns the contract, or name it in SKILL.md or a reference with the skill that owns it.`);
    }
  }

  // ---- deprecated check-lib exports ----
  if (files.includes('scripts/check-lib.mjs')) {
    const deprecated = deprecatedExports(read('scripts/check-lib.mjs'));
    for (const { rel, code } of scriptSources) {
      for (const [symbol, advice] of deprecated) {
        const match = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\b`).exec(code);
        if (match) add(rel, lineAt(code, match.index), 'deprecated-api', `uses ${symbol}, which check-lib marks @deprecated`, advice ? `${advice} (the deprecated exports leave check-lib in a later release).` : 'Move to the replacement check-lib names before the export is removed.');
      }
    }
  }

  // ---- repo scans ----
  for (const { rel, code } of scriptSources) {
    for (const { index, via } of repoScanWalks(code, read(rel))) {
      add(rel, lineAt(code, index), 'repo-scan-walk', `passes ${via === 'REPO_SCAN_IGNORES' || via === 'repoScanIgnores' ? via : `${via} (built from the repo-scan ignores)`} to walk()`, 'Use walkRepo(root, { include, ignore }): it also prunes every folder that holds a SKILL.md (installed skills plant bugs on purpose) and each workspace\'s output folders. A scan that must be wider on purpose (secrets) keeps walk() with a "// repo-scan-walk: deliberate (<why>)" comment on the line or the line above.');
    }
  }
  return files.length;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const resolved = (positionals.length > 0 ? positionals : ['.']).map((path) => resolveSkillPath(path));
  const { judged: dirs, installed } = judgedSkills(resolved);
  const report = createReporter({ name: 'check-skill', json: options.json });
  if (dirs.length === 0) {
    const fact = nothingToJudge(resolved, dirs);
    if (fact) return report.notApplicable(fact);
    fail(`nothing to check: no folder with a SKILL.md in ${positionals.join(', ') || '.'}`, 'Pass a skill folder (skills/<name>), a skills folder or the repo root.');
  }
  if (installed.length > 0) report.note(`note: ${installed.length} installed skill(s) not checked (their authors own them; pass .agents/skills to check them): ${installed.map((dir) => basename(dir)).join(', ')}`);
  // Hand-offs may name any skill of the repo: the checked skills' folders and the repo's other skill folders.
  const roots = options['skills-root'].length > 0 ? options['skills-root'].map((root) => resolve(root)) : [...new Set(resolved.flatMap((item) => [...item.roots, ...item.roots.flatMap((root) => repoSkillRoots(root))]))];
  // Hand-offs may name the skills beside the checked ones, and bundled or Expo skills (the reserved names).
  const reserved = loadStandard(options.standard ?? STANDARD_PATH).names.reserved;
  const expoSkills = new Set(reserved.filter((reservedName) => /^(?:expo|eas)-/.test(reservedName)));
  const known = new Set([...skillNamesIn(roots), ...dirs.map((dir) => basename(dir)), ...installed.map((dir) => basename(dir))]);
  const withReserved = new Set([...known, ...reserved]);
  let checked = 0;
  for (const dir of dirs) checked += checkSkill(dir, known.size >= 2 ? withReserved : known, expoSkills, report);
  return report.finish({ checked, unit: 'files' });
});
