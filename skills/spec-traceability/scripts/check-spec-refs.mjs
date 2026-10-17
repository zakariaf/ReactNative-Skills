#!/usr/bin/env node
// check-spec-refs.mjs: proves the app's requirement spec and every citation of it agree. The spec
// itself must be well formed (unique IDs, valid headings and fields, a default for every open
// decision, IDs the commit and test rules accept); every ID cited in code, tests, flows, markdown or
// commit messages must exist (no dangling IDs); "Name (ID)" pairs must name the right entry; every
// requirement marked built must be traced by a test or flow; and no test may trace excluded work.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-spec-refs.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { UsageError, createReporter, fail, lineOf, maskComments, matchGlob, parseArgs, readText, requireDir, requireFile, run, toPosix, walkRepo } from './check-lib.mjs';
import { EXCLUDED_STATUSES, PLATFORMS, SECTION, STATUSES, loadSpecConfig, namesOf, prefixAlternation, prefixedIdSource, readSpec } from './lib/spec-model.mjs';

const SPEC = {
  name: 'check-spec-refs',
  summary: 'Checks the requirement spec and every citation of it: no dangling or duplicate IDs, matching screen names, built requirements traced by a test, no test tracing excluded work, IDs the commit rules accept.',
  usage: '[repo-root] [options]',
  options: {
    spec: { type: 'string', value: 'dir', help: 'Spec folder, repo-relative (default: specDir of contracts/spec.json, else docs/spec)' },
    contract: { type: 'string', value: 'file', help: 'Spec contract, repo-relative (default: <contractsDir>/spec.json)' },
    range: { type: 'string', value: 'revs', help: 'Also check the commit messages of these commits, for example main..HEAD (runs git log)' },
    log: { type: 'string', value: 'file', help: 'Also check the commit messages of a log captured with the command below' },
    trace: { type: 'boolean', help: 'Also print the trace matrix: each traced entry with the tests and flows that cite it' },
    ignore: { type: 'string', multiple: true, value: 'glob', help: 'Skip matching paths (in addition to the defaults and the contract ignore list)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (the spec):',
    '  spec-missing            contracts/spec.json names a spec folder that does not exist',
    '  spec-empty              the spec folder holds no entry heading ("## REQ-1 · Add a task")',
    '  malformed-heading       a heading starts like an entry but is not "<ID> · <title>" (REQ 4, REQ-4 alone)',
    '  duplicate-spec-id       two entries share one ID (IDs are never reused, even after a drop)',
    '  invalid-field           a Status or Platforms value the spec format does not know',
    '  entry-field-missing     an entry lacks a field its kind requires (an open decision without Default:, a decided one without Decided:)',
    '  route-missing           an entry marked built names a "Route:" file that does not exist',
    '  ref-pattern-mismatch    a traced ID the requirement-reference pattern of contracts/commits.json,',
    '                          scripts/git/requirement-ref.json or contracts/tdd.json does not accept',
    'Rules (citations):',
    '  dangling-id             a cited ID with a configured prefix that is not in the spec',
    '  unknown-spec-section    "spec 4.9" or "spec § 4.9" when the spec has no such numbered section',
    '  screen-name-mismatch    "Settings (SCR-1)": the name belongs to another entry',
    '  untraced-requirement    a traced entry marked "Status: built" that no test or flow cites',
    '  out-of-scope-traced     a test or flow cites an entry whose status is dropped or out-of-scope',
    '',
    'Scanned: .ts .tsx .js .jsx .mjs .cjs .md .mdx .yaml .yml .txt .json, through the repo walk (installed',
    'skills, node_modules and native/build output are never read), minus *.d.ts, package-lock.json,',
    'reports/coverage, reports/stryker and scripts/git/** (the commit tooling keeps example references as data).',
    'A line holding "spec-refs-ignore" (and the line after it) is not read for citations.',
    'A repo with no contracts/spec.json and no docs/spec/ folder prints NOT APPLICABLE.',
    'rn-skills.config.json keys read: specContract (moves contracts/spec.json), tddContract (where',
    'tdd-workflow\'s contract lives), plus the layout keys contractsDir, scriptsDir, e2eDir and routesDir.',
    '',
    'Capture a log for --log (the same format check-commits.mjs of git-commits-and-reporting reads):',
    "  git log --reverse --name-only --format='==> commit %H%n%B%n==> files' <revs> > commits.log",
    '',
    'Examples:',
    '  node check-spec-refs.mjs .',
    '  node check-spec-refs.mjs . --range main..HEAD --trace',
  ].join('\n'),
};

const INCLUDE = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.md', '*.mdx', '*.yaml', '*.yml', '*.txt', '*.json'];
const DEFAULT_IGNORE = ['*.d.ts', 'package-lock.json', '.stryker-tmp', 'reports/coverage/**', 'reports/stryker/**', 'scripts/git/**'];
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const MARKER = 'spec-refs-ignore';
const DEFAULT_REF_FILE = new URL('../assets/requirement-ref.json', import.meta.url);

/** Keep only comment characters (everything else becomes a space; newlines stay). */
function commentsOnly(source) {
  const masked = maskComments(source);
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    out += ch === '\n' ? '\n' : masked[i] === ch ? ' ' : ch;
  }
  return out;
}

/** Line numbers (1-based) not read for citations: a marker line and the line after it. */
function ignoredLines(text) {
  const out = new Set();
  text.split('\n').forEach((line, index) => {
    if (line.includes(MARKER)) {
      out.add(index + 1);
      out.add(index + 2);
    }
  });
  return out;
}

/** The repo path a "Route:" field names (the first `code` span, else the first word), or null for a URL path such as /tasks/[id]. */
function routePath(value) {
  const text = (/`([^`]+)`/.exec(value)?.[1] ?? value.split(/\s/)[0] ?? '').trim();
  return /^[^/\s][^\s]*\.[cm]?[jt]sx?$/.test(text) && !text.split('/').includes('..') ? text : null;
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`, 'Run inside a git repository and pass a valid revision range.');
  return result.stdout;
}

/** Commits from a "==> commit %H / %B / ==> files" log: [{ sha, message }]. */
function parseLog(text) {
  const commits = [];
  let current = null;
  let inFiles = false;
  for (const line of text.split('\n')) {
    const start = /^==> commit ([0-9a-f]{7,40})$/.exec(line);
    if (start) {
      current = { sha: start[1].slice(0, 7), lines: [] };
      commits.push(current);
      inFiles = false;
    } else if (current && line === '==> files') inFiles = true;
    else if (current && !inFiles) current.lines.push(line);
  }
  return commits.map((commit) => ({ sha: commit.sha, message: commit.lines.join('\n').replace(/\s+$/, '') }));
}

/** Requirement-reference patterns other skills' rules apply to cited IDs: [{ re, what, widen }]. */
function referencePatterns(root, layout) {
  const out = [];
  const compile = (pattern, flags, file, what) => {
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      throw new UsageError(`${file}: ${what} is not a valid regular expression (${error.message})`, `Fix ${what} in ${file}.`);
    }
  };
  const readJson = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return null;
    try {
      return JSON.parse(readFileSync(abs, 'utf8'));
    } catch (error) {
      throw new UsageError(`${rel} is not valid JSON (${error.message})`, `Fix the JSON syntax of ${rel}.`);
    }
  };
  const commitsRel = `${layout.contractsDir}/commits.json`;
  const commits = readJson(commitsRel);
  const ref = commits?.requirementRef;
  if (ref && typeof ref.pattern === 'string') {
    out.push({ re: compile(ref.pattern, 'u', commitsRel, 'requirementRef.pattern'), what: `requirementRef.pattern of ${commitsRel} (commit bodies and Spec-Change trailers)`, widen: `widen requirementRef.pattern in ${commitsRel}` });
  } else {
    // With no repo pattern the Spec-Change trailer still needs the default reference: the app's own copy
    // of the data file when it has one, else this skill's synced copy of it.
    const appRel = `${layout.scriptsDir}/git/requirement-ref.json`;
    const app = readJson(appRel);
    const data = app ?? JSON.parse(readFileSync(DEFAULT_REF_FILE, 'utf8'));
    out.push({ re: compile(data.pattern, data.flags ?? 'u', app ? appRel : 'requirement-ref.json', 'pattern'), what: `the default requirement reference${app ? ` of ${appRel}` : ''} (Spec-Change trailers)`, widen: `set a requirementRef pattern that accepts it in ${commitsRel}` });
  }
  // tdd-workflow's contract: rn-skills.config.json "tddContract" moves it, as its own checkers read it.
  const tddConfigured = layout.config?.tddContract;
  const tddRel = typeof tddConfigured === 'string' && tddConfigured.trim() !== '' ? toPosix(tddConfigured) : `${layout.contractsDir}/tdd.json`;
  const tdd = readJson(tddRel);
  if (tdd && typeof tdd.requirementIdPattern === 'string') {
    out.push({ re: compile(tdd.requirementIdPattern, 'u', tddRel, 'requirementIdPattern'), what: `requirementIdPattern of ${tddRel} (first tests)`, widen: `widen requirementIdPattern in ${tddRel}` });
  }
  return out;
}


/**
 * A required "Default|Decided" pair follows the status: an open entry needs Default: (what the work
 * uses until someone decides), a decided one needs Decided: (the outcome). Other alternatives, and
 * entries whose status names neither, accept any of the names.
 */
const STATUS_FIELDS = { open: 'default', decided: 'decided' };
function statusFieldNames(names, status) {
  const wanted = STATUS_FIELDS[status];
  const lower = names.map((name) => name.toLowerCase());
  return names.length > 1 && wanted && lower.includes(wanted) ? [names[lower.indexOf(wanted)]] : names;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (options.range && options.log) fail('pass either --range or --log, not both', 'Use --range <revs> for a repository, or --log <file> for a captured log.');
  const report = createReporter({ name: 'check-spec-refs', json: options.json });
  const config = loadSpecConfig(root, { contract: options.contract, spec: options.spec });
  if (!config.applicable) return report.notApplicable(config.reason);

  if (!config.specExists) {
    const line = config.contractText ? lineOf(config.contractText, Math.max(0, config.contractText.indexOf('"specDir"'))) : 1;
    report.problem({ file: config.contractRel, line, rule: 'spec-missing', message: `the spec folder ${config.specRel}/ does not exist`, fix: `Create ${config.specRel}/ from the skill's templates/docs/spec/, or point specDir at the folder that holds the spec.` });
    return report.finish({ checked: 1, unit: 'spec files' });
  }

  const { entries, malformed, files: specFileList } = readSpec(root, config);
  let checked = specFileList.length;

  // ---- The spec itself -------------------------------------------------------------------------
  if (entries.length === 0) {
    report.problem({ file: specFileList[0] ?? `${config.specRel}/`, line: 1, rule: 'spec-empty', message: `${config.specRel}/ holds no entry heading`, fix: `Write each entry as a heading "## ${config.kinds[0].prefix}1 · <title>" (or copy the skill's templates/docs/spec/).` });
    checked = Math.max(checked, 1);
  }
  for (const item of malformed) {
    report.problem({ file: item.file, line: item.line, rule: 'malformed-heading', message: `${item.reason}; the entry cannot be looked up or cited`, fix: `Write the heading as "${item.heading.match(/^#+/)[0]} <ID> · <title>" with an ID made of a configured prefix (${config.kinds.map((kind) => kind.prefix).join(', ')}) and a number.` });
  }
  const firstOf = new Map();
  for (const entry of entries) {
    const first = firstOf.get(entry.id);
    if (first) {
      report.problem({ file: entry.file, line: entry.line, rule: 'duplicate-spec-id', message: `${entry.id} is already "${first.title}" (${first.file}:${first.line})`, fix: 'Give this entry the next free ID; an ID is never reused, even for a dropped entry (mark that one "Status: dropped").' });
    } else firstOf.set(entry.id, entry);
  }
  const byId = firstOf;
  for (const entry of entries) {
    const status = entry.fields.get('status');
    if (status && !STATUSES.includes(entry.status)) {
      report.problem({ file: entry.file, line: status.line, rule: 'invalid-field', message: `${entry.id} has "Status: ${status.value}"`, fix: `Use one of: ${STATUSES.join(', ')}.` });
    }
    const platforms = entry.fields.get('platforms');
    if (platforms) {
      const unknown = platforms.value.toLowerCase().split(/[\s,]+/).filter(Boolean).filter((value) => !PLATFORMS.includes(value));
      if (unknown.length) report.problem({ file: entry.file, line: platforms.line, rule: 'invalid-field', message: `${entry.id} has "Platforms: ${platforms.value}" (${unknown.join(', ')} unknown)`, fix: `List platforms from: ${PLATFORMS.join(', ')} (leave the field out when the entry applies to every platform).` });
    }
    const route = entry.fields.get('route');
    if (route && entry.status === 'built') {
      const path = routePath(route.value);
      if (path && !existsSync(join(root, path))) {
        report.problem({ file: entry.file, line: route.line, rule: 'route-missing', message: `${entry.id} · ${entry.title} is marked built, but its route ${path} does not exist`, fix: `Point "Route:" at the route file that renders it (under ${config.layout.routesDir}/), or set its Status back to in-progress.` });
      }
    }
    if (!entry.kindSpec || EXCLUDED_STATUSES.includes(entry.status)) continue;
    for (const required of entry.kindSpec.requiredFields) {
      const names = statusFieldNames(required.split('|').map((name) => name.trim()).filter(Boolean), entry.status);
      if (!names.some((name) => entry.fields.has(name.toLowerCase()))) {
        const why = names.length === 1 && STATUS_FIELDS[entry.status] === names[0].toLowerCase() ? ` (Status: ${entry.status} needs it: ${entry.status === 'decided' ? 'a settled decision records its outcome' : 'an open decision names the default the work uses meanwhile'})` : '';
        report.problem({ file: entry.file, line: entry.line, rule: 'entry-field-missing', message: `${entry.kind} ${entry.id} · ${entry.title} has no ${names.map((name) => `"${name}:"`).join(' or ')} line${why}`, fix: `Add "- ${names[0]}: <value>" to the entry's own text, above any sub-heading (every ${entry.kind} carries it).` });
      }
    }
  }
  const traced = entries.filter((entry) => entry.kindSpec?.traced && byId.get(entry.id) === entry && !EXCLUDED_STATUSES.includes(entry.status));
  for (const pattern of referencePatterns(root, config.layout)) {
    for (const entry of traced) {
      if (!pattern.re.test(entry.id)) {
        const stem = entry.kindSpec.prefix.replace(/[-_]?$/, '-');
        report.problem({ file: entry.file, line: entry.line, rule: 'ref-pattern-mismatch', message: `${entry.id} does not match ${pattern.what}, /${pattern.re.source}/: a commit or test that cites it is rejected`, fix: `Use IDs the pattern accepts (a capital prefix ending in "-" and a plain number, such as ${stem}4 or ${stem}4.1), or ${pattern.widen}.` });
      }
    }
  }

  // ---- Citations ---------------------------------------------------------------------------------
  const sectionsOn = config.sections === true || (config.sections === 'auto' && entries.some((entry) => entry.kind === 'section'));
  const everywhereKinds = config.kinds.filter((kind) => kind.bareIn === 'everywhere');
  const commentKinds = config.kinds.filter((kind) => kind.bareIn === 'comments');
  const everywhereRe = everywhereKinds.length ? new RegExp(prefixedIdSource(everywhereKinds), 'g') : null;
  const commentRe = commentKinds.length ? new RegExp(prefixedIdSource(commentKinds), 'g') : null;
  const sectionRe = new RegExp(String.raw`\bspec(?:'s)?(?:\s+sections?\s+|\s*§\s*|\s+)(${SECTION}(?:\s*(?:,|and|or|to|-|–|/|&)\s*${SECTION})*)`, 'gi');
  const namedEntries = entries.filter((entry) => entry.kindSpec?.named && byId.get(entry.id) === entry);
  const nameOwners = new Map();
  for (const entry of namedEntries) for (const name of namesOf(entry, config.aliases)) nameOwners.set(name, [...(nameOwners.get(name) ?? []), entry.id]);
  const namedPrefixes = config.kinds.filter((kind) => kind.named);
  const nameAlt = [...nameOwners.keys()].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|');
  const namedId = namedPrefixes.length ? String.raw`(?:${prefixAlternation(namedPrefixes)})\d{1,4}(?:\.\d{1,3}){0,2}[a-z]?(?![A-Za-z0-9_]|\.\d)` : null;
  const pairPatterns = nameAlt && namedId
    ? [
        { re: new RegExp(String.raw`(?<![\w-])(${nameAlt})\s*\(\s*(${namedId})`, 'gi'), name: 1, id: 2 },
        { re: new RegExp(String.raw`\(\s*(${nameAlt})\s*,\s*(${namedId})\s*\)`, 'gi'), name: 1, id: 2 },
        { re: new RegExp(String.raw`(?<![\w-])(${namedId})\s*\(\s*(${nameAlt})\s*\)`, 'gi'), name: 2, id: 1 },
      ]
    : [];
  /** An ID's ancestors: SCR-3 for SCR-3.1, SCR-11 for SCR-11a. */
  const lineage = (id) => {
    const out = [id];
    let current = id;
    for (;;) {
      const next = /[a-z]$/.test(current) ? current.slice(0, -1) : current.includes('.') ? current.slice(0, current.lastIndexOf('.')) : null;
      if (!next || next === current) break;
      out.push(next);
      current = next;
    }
    return out;
  };

  const seen = new Set();
  const traceMap = new Map();
  const flag = (file, text, index, id, rule, message, fix, lineOffset = 0) => {
    const line = lineOf(text, index) + lineOffset;
    const key = `${file}:${line}:${id}:${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    report.problem({ file, line, rule, message, fix });
  };
  const listIds = config.kinds.map((kind) => `${kind.prefix}<n>`).join(', ');

  /** Every citation in one text: [{ id, index, kind: 'id' | 'section' }]. */
  const citationsIn = (text, { code }) => {
    const out = [];
    const skip = ignoredLines(text);
    const keep = (index) => !skip.has(lineOf(text, index));
    if (everywhereRe) for (const match of text.matchAll(everywhereRe)) if (keep(match.index)) out.push({ id: `${match[1]}${match[2]}`, index: match.index, kind: 'id' });
    if (commentRe) {
      const view = code ? commentsOnly(text) : text;
      for (const match of view.matchAll(commentRe)) if (keep(match.index)) out.push({ id: `${match[1]}${match[2]}`, index: match.index, kind: 'id' });
    }
    if (sectionsOn) {
      for (const match of text.matchAll(sectionRe)) {
        const start = match.index + match[0].lastIndexOf(match[1]);
        for (const part of match[1].matchAll(new RegExp(SECTION, 'g'))) if (keep(start + part.index)) out.push({ id: part[0], index: start + part.index, kind: 'section' });
      }
    }
    return out;
  };
  // A malformed heading is reported once, as malformed-heading, not again as a dangling citation.
  const malformedLines = new Set(malformed.map((item) => `${item.file}:${item.line}`));
  const checkCitations = (file, text, citations, lineOffset = 0) => {
    for (const citation of citations) {
      if (byId.has(citation.id)) continue;
      if (lineOffset === 0 && malformedLines.has(`${file}:${lineOf(text, citation.index)}`)) continue;
      if (citation.kind === 'section') {
        flag(file, text, citation.index, citation.id, 'unknown-spec-section', `"spec ${citation.id}" names no numbered section of the spec`, 'Look the section up with spec-lookup.mjs --list and cite the right number, or the entry ID.', lineOffset);
      } else {
        const kind = config.kinds.find((item) => citation.id.startsWith(item.prefix));
        flag(file, text, citation.index, citation.id, 'dangling-id', `"${citation.id}" is not a ${kind?.kind ?? 'spec'} entry in ${config.specRel}/`, `Cite an ID that exists (spec-lookup.mjs --list shows ${listIds}); a new ${kind?.kind ?? 'entry'} is added to the spec first, by a person or with their agreement.`, lineOffset);
      }
    }
  };

  const files = walkRepo(root, { include: INCLUDE, ignore: [...DEFAULT_IGNORE, ...config.ignore, ...(options.ignore ?? [])] });
  for (const rel of files) {
    const text = readText(join(root, rel));
    if (text === null) continue;
    checked += specFileList.includes(rel) ? 0 : 1;
    const code = CODE.test(rel);
    const citations = citationsIn(text, { code });
    checkCitations(rel, text, citations);
    const isTrace = config.traceGlobs.some((glob) => matchGlob(rel, glob));
    if (isTrace) {
      for (const citation of citations) {
        const entry = byId.get(citation.id);
        if (!entry || citation.kind !== 'id') continue;
        if (!traceMap.has(entry.id)) traceMap.set(entry.id, new Set());
        traceMap.get(entry.id).add(rel);
        if (EXCLUDED_STATUSES.includes(entry.status)) {
          flag(rel, text, citation.index, entry.id, 'out-of-scope-traced', `this test or flow cites ${entry.id} · ${entry.title}, which the spec marks ${entry.status}`, 'Do not build excluded work: remove the test and its code, or ask the reviewer to bring the entry back into scope in the spec first. A guard test proving the work stays absent cites the NN- or requirement that keeps it out instead (references/spec-format.md, Tracing).');
        }
      }
    }
    if (pairPatterns.length) {
      const skip = ignoredLines(text);
      for (const pattern of pairPatterns) {
        for (const match of text.matchAll(pattern.re)) {
          if (skip.has(lineOf(text, match.index))) continue;
          const id = match[pattern.id].replace(/^[a-z]+/i, (prefix) => prefix.toUpperCase());
          if (!byId.has(id)) continue;
          const name = match[pattern.name].toLowerCase().replace(/\s+/g, ' ');
          const owners = nameOwners.get(name) ?? [];
          if (!lineage(id).some((ancestor) => owners.includes(ancestor))) {
            flag(rel, text, match.index, id, 'screen-name-mismatch', `"${match[0].trim()}" pairs the name "${match[pattern.name]}" with ${id}, which is "${byId.get(id).title}"`, `Name the entry by its own title (${byId.get(id).title} (${id})), or fix the ID; add a second name to aliases in contracts/spec.json if the spec uses one.`);
          }
        }
      }
    }
  }

  // ---- Commit messages ---------------------------------------------------------------------------
  if (options.range || options.log) {
    const text = options.log ? readFileSync(requireFile(options.log, 'log file'), 'utf8') : git(root, ['log', '--reverse', '--name-only', '--format===> commit %H%n%B%n==> files', options.range]);
    const commits = parseLog(text);
    // An empty --range (base equals HEAD, or the work is not committed yet) still leaves the file scan
    // to check; an empty --log file is bad input.
    if (commits.length === 0 && options.range) report.note(`NOTE --range ${options.range} holds no commit yet: only the files were checked (rerun with --range once the session's commits exist)`);
    else if (commits.length === 0) fail('nothing to check: the log holds no commit', `Capture it with: git log --reverse --name-only --format='==> commit %H%n%B%n==> files' <revs>`);
    for (const commit of commits) {
      checked += 1;
      checkCitations(commit.sha, commit.message, citationsIn(commit.message, { code: false }));
    }
  }

  // ---- Traceability --------------------------------------------------------------------------------
  for (const entry of traced) {
    if (entry.status === 'built' && !traceMap.has(entry.id)) {
      report.problem({ file: entry.file, line: entry.line, rule: 'untraced-requirement', message: `${entry.id} · ${entry.title} is marked built, but no test or flow cites it`, fix: `Quote ${entry.id} in the title or a comment of the test that proves it (the first failing test of the slice), or set its Status back to in-progress.` });
    }
  }
  if (options.trace) {
    for (const entry of traced) {
      const where = [...(traceMap.get(entry.id) ?? [])];
      report.note(`TRACE ${entry.id} [${entry.status}] ${entry.title}: ${where.length ? where.join(', ') : 'no test or flow'}`);
    }
  }
  return report.finish({ checked, unit: 'files and commits' });
});
