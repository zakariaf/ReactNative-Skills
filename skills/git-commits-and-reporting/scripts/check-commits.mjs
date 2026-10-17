#!/usr/bin/env node
// check-commits.mjs: checks commit messages against the commit format: a Conventional Commits header
// with a known scope, an imperative lowercase subject, a body that says why (and, when the repo asks
// for it, the requirement a feat or fix serves), and the Gate-Change and Spec-Change trailers in the
// last paragraph. The rules and their ids are those of the repo's commit-msg hook
// (scripts/git/commit-message-rules.ts, a template of this skill); --samples runs the shared sample
// list both test suites use, so the two cannot drift.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-commits.mjs . --range main..HEAD
//      node ${CLAUDE_SKILL_DIR}/scripts/check-commits.mjs . --message reports/commit-message.txt --staged

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_SKILL_FOLDERS, createReporter, fail, globToRegExp, parseArgs, readWorkspaces, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const SPEC = {
  name: 'check-commits',
  summary: 'Checks commit messages (a planned message file, a revision range, or a captured log) against the commit format, the trailer rules and the gated paths: the same rules, with the same ids, as the repo\'s commit-msg hook.',
  usage: '[repo-root] (--message <file> | --range <revs> | --log <file> | --samples <file>) [options]',
  options: {
    message: { type: 'string', value: 'file', help: 'One planned commit message (for example reports/commit-message.txt)' },
    staged: { type: 'boolean', help: 'With --message: read the staged files from git for the Gate-Change rule' },
    files: { type: 'string', value: 'a,b', help: 'With --message: the files the commit changes, comma-separated' },
    range: { type: 'string', value: 'revs', help: 'Commits to check, for example main..HEAD (runs git log)' },
    log: { type: 'string', value: 'file', help: 'A log captured with the command below' },
    samples: { type: 'string', value: 'file', help: 'A commit-message-samples.json list: every sample must give exactly its listed rule ids' },
    scope: { type: 'string', multiple: true, value: 'name', help: 'Accept an extra scope for this run' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'The repo root is the optional positional argument (default "."). The commit-msg hook',
    '(scripts/git/check-commit-message.ts) enforces the same 18 rules with the same ids.',
    '',
    'Rules:',
    '  header-format        the header is not "type(scope): subject"',
    '  header-type          the type is not feat, fix, perf, refactor, test, docs, build, ci, chore, style or revert',
    '  scope-missing        the header has no scope',
    '  header-scope         the scope is not a folder under src/features/ or src/ (workspace folders when',
    '                       multi-package), an extra scope of contracts/commits.json, or a fixed scope:',
    '                       repo, deps, docs, ci, tooling, e2e, release, skills',
    '  header-length        the header is longer than 72 characters',
    '  subject-case         the subject starts with a capital letter',
    '  subject-period       the subject ends with a period',
    '  subject-mood         the subject is not imperative ("added", "fixes", "updating")',
    '  subject-vague        the subject says nothing ("wip", "fix", "update", "changes")',
    '  blank-line           the body does not start after one blank line',
    '  body-missing         a feat or fix commit has no body saying why',
    '  spec-ref-missing     only when contracts/commits.json sets "requirementRef": a feat or fix outside its',
    '                       exempt scopes names no requirement reference matching the pattern',
    '  trailer-placement    a trailer sits outside the last paragraph (git would not read it)',
    '  trailer-empty        a Gate-Change or Spec-Change trailer has no real reason (under 10 characters)',
    '  spec-change-format   a Spec-Change trailer names no requirement (the contract pattern, or by default',
    '                       #123, TASK-12, "spec 4.2", "issue 31", ...)',
    '  gate-change-missing  a changed file matches quality-gates.json gatedPaths and there is no',
    '                       "Gate-Change: <reason>" trailer (whole-path match; a file in an agent folder such',
    '                       as skills/ or .agents/ counts only for a pattern that starts with that folder)',
    '  gate-change-unneeded a Gate-Change trailer but no gated file changed (only when the files are known)',
    '  placeholder-left     a __PLACEHOLDER__ of the commit-message template is still in the message',
    '  comment-line         (--range, --log) a stored message holds a "#" line: a template hint was committed',
    '                       with "git commit -F" (which keeps comment lines); commit with --cleanup=strip',
    '  sample-mismatch      (--samples) a sample gives other rule ids than the list says: the hook and this',
    '                       checker have drifted',
    '',
    'Gated paths come from <repo>/quality-gates.json (quality-gates owns it); without that file the',
    'canonical list in assets/quality-gates.json applies. Scopes and the requirement rule come from',
    '<contractsDir>/commits.json when it exists (templates/contracts/commits.json). Like the hook, the',
    'checker reads two keys of rn-skills.config.json: "srcDir" (default src; scopes are the folders under',
    '<srcDir>/features/ and <srcDir>/) and "contractsDir" (default contracts); other scope folders go in',
    'the contract\'s "scopeFolders". The default requirement reference is templates/scripts/git/',
    'requirement-ref.json, the file the hook reads. --staged with nothing staged judges HEAD\'s files, as',
    'the hook does during an amend; reword with git reset --soft HEAD~1 and a fresh commit instead.',
    'With --message, comment lines (#) and everything below git\'s scissors line are dropped first, as',
    'git does in its editor flow. Git-generated headers (Merge, Revert ", fixup!, squash!, amend!) pass.',
    'Capture a log for --log:',
    "  git log --reverse --name-only --format='==> commit %H%n%B%n==> files' <revs> > commits.log",
  ].join('\n'),
};

const TYPES = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'build', 'ci', 'chore', 'style', 'revert'];
const FIXED_SCOPES = ['repo', 'deps', 'docs', 'ci', 'tooling', 'e2e', 'release', 'skills'];
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>\S.*)$/u;
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/u;
const KNOWN_TRAILER = /^(Gate-Change|Spec-Change|Co-Authored-By|Signed-off-by|Refs):\s*(.*)$/iu;
const ANY_TRAILER = /^[A-Za-z-]+:\s/u;
const MOVABLE_TRAILER = /^(Gate-Change|Spec-Change|Co-Authored-By):/iu;
/** The default the hook reads too: templates/scripts/git/requirement-ref.json (one source). */
const DEFAULT_REQUIREMENT_REF = (() => {
  const { pattern, flags } = JSON.parse(readFileSync(join(SKILL_DIR, 'templates', 'scripts', 'git', 'requirement-ref.json'), 'utf8'));
  return new RegExp(pattern, flags);
})();
const NOT_IMPERATIVE = new Set('added adds adding fixed fixes fixing updated updates updating changed changes changing removed removes removing created creates creating improved improves improving refactored refactors refactoring implemented implements implementing made makes making moved moves moving renamed renames renaming deleted deletes deleting introduced introduces introducing bumped bumps bumping upgraded upgrades upgrading replaced replaces replacing cleaned cleans cleaning wrote writes writing merged merges merging tested tests testing'.split(' '));
const VAGUE = /^(wip|misc|stuff|update|updates|changes|change|fix|fixes|tweak|tweaks|cleanup|work|progress|temp|tmp)$/iu;
const MIN_REASON = 10;
const AGENT_FOLDERS = AGENT_SKILL_FOLDERS.map((folder) => `${folder}/`);
/**
 * The same paths as scripts/git/commit-config.ts (COMMITS_CONTRACT, scopeFoldersOf): the contract in
 * the contracts folder, scopes under <srcDir>/features/ and <srcDir>/. Both read only srcDir and
 * contractsDir of rn-skills.config.json, so the hook and this checker always see the same facts.
 */
const COMMITS_CONTRACT = 'commits.json';
const scopeFoldersOf = (srcDir) => [`${srcDir}/features/*`, `${srcDir}/*`];

function git(repo, args) {
  // core.quotePath=false: a non-ASCII file name (a localized baseline) stays a plain path the gated
  // globs can match, as the hook sees it with -z.
  const result = spawnSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`, 'Run inside a git repository and pass a valid revision range.');
  return result.stdout;
}

function parseLog(text) {
  const commits = [];
  let current = null;
  let inFiles = false;
  for (const line of text.split('\n')) {
    const start = /^==> commit ([0-9a-f]{7,40})$/.exec(line);
    if (start) {
      current = { sha: start[1].slice(0, 7), message: [], files: [] };
      commits.push(current);
      inFiles = false;
    } else if (current && line === '==> files') inFiles = true;
    else if (current && inFiles) {
      if (line.trim()) current.files.push(line.trim());
    } else if (current) current.message.push(line);
  }
  return commits.map((commit) => ({ ...commit, message: commit.message.join('\n').replace(/\s+$/, ''), stored: true }));
}

function paragraphs(lines) {
  const out = [];
  let current = [];
  lines.forEach((text, index) => {
    if (text.trim() === '') {
      if (current.length) out.push(current);
      current = [];
    } else current.push({ text, line: index + 1 });
  });
  if (current.length) out.push(current);
  return out;
}

function checkHeader(add, header, scopes) {
  const match = HEADER.exec(header);
  if (!match) {
    add(1, 'header-format', `header "${header}" is not "type(scope): subject"`, 'Write "<type>(<scope>): <imperative subject>", for example "feat(tasks): keep a draft when the app is killed".');
    return null;
  }
  const { type, scope, subject } = match.groups;
  if (!TYPES.includes(type)) add(1, 'header-type', `type "${type}" is unknown`, `Use one of ${TYPES.join(', ')}.`);
  if (scope === undefined || scope === '') add(1, 'scope-missing', 'the header has no scope', `Name where the change lives: ${scopes.slice(0, 8).join(', ')}, ...`);
  else if (!scopes.includes(scope)) add(1, 'header-scope', `scope "${scope}" is not one of ${scopes.join(', ')}`, 'Use a feature folder, a src/ layer or a fixed scope; a new kind of scope goes into contracts/commits.json "extraScopes".');
  if (header.length > 72) add(1, 'header-length', `header is ${header.length} characters`, 'Shorten the subject; the header holds at most 72 characters.');
  if (/^[A-Z]/.test(subject)) add(1, 'subject-case', `subject "${subject}" starts with a capital letter`, 'Start the subject in lowercase.');
  if (/\.$/.test(subject)) add(1, 'subject-period', 'the subject ends with a period', 'Drop the trailing period.');
  const first = subject.split(/\s+/)[0].toLowerCase();
  if (NOT_IMPERATIVE.has(first)) add(1, 'subject-mood', `subject starts with "${first}"`, 'Use the imperative, as in a command: "add", "fix", "keep" ("keep the draft", not "kept the draft").');
  if (VAGUE.test(subject.trim())) add(1, 'subject-vague', `subject "${subject}" says nothing`, 'Say what changes for the user or the code: "keep the draft when the app is killed".');
  return { type, scope: scope ?? '' };
}

const matchGlobWhole = typeof nodePath.matchesGlob === 'function' ? (file, pattern) => nodePath.matchesGlob(file, pattern) : (file, pattern) => globToRegExp(pattern).test(file);

/** The same rule as quality-gates' scripts/quality/gated-paths.ts isGatedFile. */
function isGatedFile(file, pattern) {
  const folder = AGENT_FOLDERS.find((prefix) => file.startsWith(prefix));
  if (folder !== undefined && !pattern.startsWith(folder)) return false;
  return matchGlobWhole(file, pattern);
}

function checkTrailers(add, lines, files, context) {
  const paras = paragraphs(lines);
  const last = paras.length > 1 ? paras.at(-1) : [];
  const lastIsTrailers = last.length > 0 && last.every((entry) => KNOWN_TRAILER.test(entry.text) || ANY_TRAILER.test(entry.text));
  const trailers = lastIsTrailers ? last : [];
  for (const entry of paras.slice(1, lastIsTrailers ? -1 : undefined).flat()) {
    if (MOVABLE_TRAILER.test(entry.text)) add(entry.line, 'trailer-placement', `"${entry.text.slice(0, 40)}" is not in the last paragraph`, 'Move every trailer into one final paragraph after a blank line; git reads trailers only there.');
  }
  const find = (key) => trailers.filter((entry) => entry.text.toLowerCase().startsWith(`${key.toLowerCase()}:`));
  const reason = (entry) => entry.text.replace(/^[^:]+:\s*/, '').trim();
  const gateTrailers = find('Gate-Change');
  for (const entry of [...gateTrailers, ...find('Spec-Change')]) {
    if (reason(entry).length < MIN_REASON) add(entry.line, 'trailer-empty', `"${entry.text}" gives no real reason`, 'Say why in a few words: "Gate-Change: new task-row golden after the due-date line moved".');
  }
  for (const entry of find('Spec-Change')) {
    if (!context.requirement.pattern.test(reason(entry))) add(entry.line, 'spec-change-format', `"${entry.text.slice(0, 60)}" names no requirement`, 'Write "Spec-Change: <requirement reference> <what changed>", for example "Spec-Change: TASK-40 weekly repeats now skip public holidays"; a test that was wrong is fixed, never a Spec-Change.');
  }
  if (files === null) return;
  const gatedFiles = files.filter((file) => context.gated.some((pattern) => isGatedFile(file, pattern)));
  if (gatedFiles.length > 0 && gateTrailers.length === 0) add(1, 'gate-change-missing', `gated files changed without a Gate-Change trailer: ${gatedFiles.slice(0, 4).join(', ')}`, 'Add a final paragraph "Gate-Change: <why the gate, golden, baseline or fixture had to change>" (a gate config only after the reviewer agreed).');
  if (gatedFiles.length === 0 && gateTrailers.length > 0) add(gateTrailers[0].line, 'gate-change-unneeded', 'a Gate-Change trailer but no gated file changed', 'Remove the trailer; gate changes are listed by it, so it must be exact.');
}

function checkMessage(report, where, commit, context) {
  const lines = commit.message.split('\n');
  const header = lines[0] ?? '';
  if (GIT_GENERATED.test(header)) return;
  const add = (line, rule, text, fix) => report.problem({ file: where, line, rule, message: text, fix });
  const parsed = checkHeader(add, header, context.scopes);
  if (lines.length > 1 && lines[1].trim() !== '') add(2, 'blank-line', 'the second line is not blank', 'Leave one blank line between the header and the body.');
  const body = lines.slice(1).join('\n').trim();
  const prose = lines.slice(1).filter((line) => !KNOWN_TRAILER.test(line)).join('\n').trim();
  const featOrFix = parsed && (parsed.type === 'feat' || parsed.type === 'fix');
  if (featOrFix && prose === '') add(1, 'body-missing', `a ${parsed.type} commit has no body`, 'Add a body that says why the change was made (and what the tests prove).');
  const { requirement } = context;
  if (featOrFix && requirement.required && !requirement.exemptScopes.includes(parsed.scope) && body !== '' && !requirement.pattern.test(body)) add(1, 'spec-ref-missing', 'the body names no requirement reference', `Name the requirement the change serves (pattern ${requirement.pattern.source} from contracts/commits.json).`);
  checkTrailers(add, lines, commit.files, context);
  lines.forEach((text, index) => {
    const placeholder = /__[A-Z][A-Z0-9_]*__/.exec(text);
    if (placeholder) add(index + 1, 'placeholder-left', `placeholder ${placeholder[0]} is left`, 'Replace every __PLACEHOLDER__ of the template with real text, and delete the trailer lines that do not apply.');
    if (commit.stored && text.startsWith('#')) add(index + 1, 'comment-line', `the stored message holds the comment line "${text.slice(0, 40)}"`, 'Commit message files with "git commit --cleanup=strip -F <file>" (plain -F keeps # lines). Reword an unpushed commit of this session with "git reset --soft HEAD~1" and "git commit --cleanup=strip -F <file>" (the commit-msg hook then sees every file of the commit; --amend hides them); report a pushed one.');
  });
}

/** The message as git's editor flow stores it: no comment lines, nothing below the scissors. */
function normalizeMessage(raw) {
  const cut = /^# -+ >8 -+$/m.exec(raw);
  return (cut ? raw.slice(0, cut.index) : raw).split('\n').filter((line) => !line.startsWith('#')).join('\n').replace(/\s+$/, '');
}

function readJsonFile(file, what, fix) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`${what} ${file} is not valid JSON (${error.message})`, fix);
  }
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The requirement rule: off (any reference names a Spec-Change) unless the contract sets one. */
function requirementOf(ref) {
  if (ref === undefined || ref === null) return { pattern: DEFAULT_REQUIREMENT_REF, required: false, exemptScopes: FIXED_SCOPES };
  let pattern;
  try {
    pattern = new RegExp(ref.pattern, 'u');
  } catch (error) {
    fail(`requirementRef.pattern is not a valid regular expression (${error.message})`, 'Fix the pattern in contracts/commits.json.');
  }
  return { pattern, required: ref.required ?? true, exemptScopes: ref.exemptScopes ?? FIXED_SCOPES };
}

function scopesOfFolder(root, entry) {
  const wildcard = entry.endsWith('/*');
  const folder = join(root, wildcard ? entry.slice(0, -2) : entry);
  if (!existsSync(folder)) return [];
  if (!wildcard) return [basename(folder)];
  return readdirSync(folder, { withFileTypes: true }).filter((item) => item.isDirectory() && !/^[.(_]/.test(item.name)).map((item) => item.name);
}

/** Scopes, gated paths and the requirement rule, read the way scripts/git/commit-config.ts reads them. */
function repoContext(root, extraScopes) {
  const layout = resolveLayout(root);
  const contractFile = join(root, layout.contractsDir, COMMITS_CONTRACT);
  const contract = existsSync(contractFile) ? readJsonFile(contractFile, 'contract', 'Restore it from templates/contracts/commits.json.') : {};
  const ref = contract.requirementRef;
  if ([contract.scopeFolders, contract.extraScopes, ref?.exemptScopes].some((list) => list !== undefined && !isStringList(list)) || (ref !== undefined && ref !== null && typeof ref?.pattern !== 'string')) fail(`${contractFile} does not match contracts/commits.schema.json`, 'scopeFolders and extraScopes are lists of strings; requirementRef is null or { "pattern": "<regex>", "required": true, "exemptScopes": [...] }.');
  const workspaceGlobs = readWorkspaces(root).length > 0 ? workspaceFolderGlobs(root) : [];
  const folders = contract.scopeFolders ?? [...workspaceGlobs, ...scopeFoldersOf(layout.srcDir)];
  const scopes = [...new Set([...folders.flatMap((entry) => scopesOfFolder(root, entry)), ...(contract.extraScopes ?? []), ...FIXED_SCOPES, ...extraScopes])].sort();
  const gatesFile = join(root, 'quality-gates.json');
  const gates = existsSync(gatesFile) ? readJsonFile(gatesFile, 'quality-gates.json', 'Restore it from the quality-gates templates.') : readJsonFile(join(SKILL_DIR, 'assets', 'quality-gates.json'), 'canonical gates', 'Reinstall this skill.');
  const gated = isStringList(gates.gatedPaths) ? gates.gatedPaths : [];
  return { scopes, gated, requirement: requirementOf(ref) };
}

function workspaceFolderGlobs(root) {
  const manifest = readJsonFile(join(root, 'package.json'), 'package.json', 'Fix package.json.');
  const list = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
  return isStringList(list) ? list : [];
}

const pathsOf = (output) => output.split('\0').filter(Boolean);

/** The staged files, or HEAD's files when nothing is staged (an amend or reword), as the hook judges. */
function stagedOrHeadFiles(root) {
  const staged = pathsOf(git(root, ['diff', '--cached', '--name-only', '-z']));
  const hasHead = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD']).status === 0;
  if (staged.length > 0 || !hasHead) return staged;
  return pathsOf(git(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']));
}

/** --samples: every sample of the shared list must give exactly its rule ids (hook and checker agree). */
function checkSamples(file, report) {
  const data = readJsonFile(requireFile(file, 'sample list'), 'sample list', 'Restore templates/scripts/git/commit-message-samples.json.');
  if (!Array.isArray(data.samples) || !isStringList(data.scopes) || !isStringList(data.gatedPaths)) fail(`${file} needs "scopes", "gatedPaths" and "samples"`, 'Restore templates/scripts/git/commit-message-samples.json.');
  for (const sample of data.samples) {
    const context = { scopes: data.scopes, gated: data.gatedPaths, requirement: requirementOf('requirementRef' in sample ? sample.requirementRef : data.requirementRef) };
    const found = [];
    checkMessage({ problem: (entry) => found.push(entry.rule) }, sample.name, { message: normalizeMessage(sample.message), files: sample.files ?? null, stored: false }, context);
    const got = [...new Set(found)].sort();
    const want = [...new Set(sample.rules ?? [])].sort();
    if (got.join(',') !== want.join(',')) report.problem({ file, line: 0, rule: 'sample-mismatch', message: `sample "${sample.name}" gives [${got.join(', ')}] but the list says [${want.join(', ')}]`, fix: 'The commit-msg hook (scripts/git/commit-message-rules.ts) and check-commits.mjs must agree: fix whichever rule drifted, and change a sample only together with both rule sets.' });
  }
  return data.samples.length;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const modes = [options.message, options.range, options.log, options.samples].filter(Boolean);
  if (modes.length !== 1) fail('pass exactly one of --message, --range, --log or --samples', 'Run with --help to see the modes.');
  const report = createReporter({ name: 'check-commits', json: options.json });
  if (options.samples) return report.finish({ checked: checkSamples(options.samples, report), unit: 'samples' });
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const context = repoContext(root, options.scope ?? []);
  let commits;
  if (options.message) {
    const text = normalizeMessage(readFileSync(requireFile(options.message, 'message file'), 'utf8'));
    let files = null;
    if (options.files) files = options.files.split(',').map((file) => file.trim()).filter(Boolean);
    else if (options.staged) files = stagedOrHeadFiles(root);
    commits = [{ sha: options.message, message: text, files, stored: false }];
  } else {
    const text = options.log ? readFileSync(requireFile(options.log, 'log file'), 'utf8') : git(root, ['log', '--reverse', '--name-only', '--format===> commit %H%n%B%n==> files', options.range]);
    commits = parseLog(text);
    if (commits.length === 0) fail('the log or range holds no commits', 'Pass a range that contains the new commits, for example main..HEAD.');
  }
  for (const commit of commits) checkMessage(report, commit.sha, commit, context);
  return report.finish({ checked: commits.length, unit: 'commit messages' });
});
