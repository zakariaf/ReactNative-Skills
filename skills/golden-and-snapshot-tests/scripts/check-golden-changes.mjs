#!/usr/bin/env node
// check-golden-changes.mjs: reads commits (or the staged change) and fails when a golden, a baseline
// or the pixel matcher changed without a Gate-Change trailer, when an existing [contract] golden entry
// was edited or deleted (never allowed), or when a tolerance went up without the reviewer's approval.
// Paths under installed skills (skills/, .agents/, .claude/, any folder holding a SKILL.md) and
// generated output are never the app's goldens: a skill's fixtures change golden-shaped files on purpose.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-golden-changes.mjs [repo-root] --range <base>..HEAD

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { createReporter, fail, isRepoScanIgnored, matchGlob, parseArgs, requireDir, requireFile, run } from './check-lib.mjs';
import { goldenPathGlobs, isContractKey, loadGoldenSetup } from './lib/golden-config.mjs';

const FORMAT = '==> commit %H%n%B%n==> diff';
const SPEC = {
  name: 'check-golden-changes',
  summary: 'Checks commits (or the staged change) for the golden policy: a Gate-Change trailer on every golden change, [contract] entries never edited or deleted, tolerances never raised without approval.',
  usage: '[repo-root] (--range <revs> | --log <file> | --staged [--message <file>]) [options]',
  options: {
    range: { type: 'string', value: 'revs', help: 'Commits to check, for example main..HEAD or HEAD~5..HEAD (runs git log)' },
    log: { type: 'string', value: 'file', help: 'A log captured earlier with the command below' },
    staged: { type: 'boolean', help: 'Check the staged change (git diff --cached) as one commit' },
    message: { type: 'string', value: 'file', help: 'With --staged: the planned commit message (for its trailers)' },
    matcher: { type: 'string', value: 'file', help: 'The shared pixel matcher (default: rn-skills.config.json "pixelMatcher", else test/goldens/skia-golden.ts)' },
    contract: { type: 'string', value: 'file', help: 'The goldens contract (default: "goldensContract", else contracts/goldens.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'The repo root is the optional positional argument (default "."); its contracts/goldens.json adds golden paths',
    'and contract markers.',
    '',
    'Rules:',
    '  gate-change-missing     a commit adds, changes or deletes a golden path without "Gate-Change: <reason>" (10+ chars)',
    '  contract-golden-changed a commit edits or deletes an existing snapshot entry whose key carries a contract marker',
    '                          ([contract] by default); never allowed, even with a trailer (adding an entry is fine)',
    '  tolerance-raised        failureThreshold, MAX_DIFF_RATIO, PIXEL_THRESHOLD (the E2E per-pixel distance), maxDiffRatio or maxPixelTolerance went up without an approved Gate-Change trailer',
    '                          that says the new value was approved ("approved by <reviewer>")',
    '',
    'Golden paths: **/*.golden.test.ts.snap(.ios|.android), **/__image_snapshots__/** (not __diff_output__), the pixel',
    'matcher, <e2eDir>/baselines/**, contracts/goldens.json itself and its "goldenPaths". Never under skills/, .agents/, .claude/,',
    'node_modules, generated ios/, android/, build/ (check-lib REPO_SCAN_IGNORES) or a folder holding a SKILL.md.',
    '',
    'Capture a log for --log (the format --range reads; -U200 keeps the exports[ line of each changed snapshot entry):',
    `  git log --reverse -M -U200 -p --no-color --format='${FORMAT}' <revs> > history.log`,
    'Git-generated commits (Merge, Revert ", fixup!, squash!, amend!) are skipped.',
  ].join('\n'),
};

const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;
const TOLERANCE = /\b(failureThreshold|MAX_DIFF_RATIO|PIXEL_THRESHOLD|maxDiffRatio|maxPixelTolerance)\b["']?\s*[:=]\s*([0-9]*\.?[0-9]+(?:e-?\d+)?)/;

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim().split('\n')[0]}`, 'Run inside a git repository and pass a valid revision range.');
  return result.stdout;
}

/** Split `git diff` / `git log -p` text into files with their removed (with snapshot entry) and added lines. */
function parseDiff(lines) {
  const files = [];
  let file = null;
  let oldLine = 0;
  let entry = null;
  for (const line of lines) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      file = { oldPath: header[1], path: header[2], status: 'modified', removed: [], added: [] };
      files.push(file);
      entry = null;
      continue;
    }
    if (!file) continue;
    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename to ')) file.status = 'renamed';
    else if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ') || line.startsWith('Binary files')) continue;
    else if (line.startsWith('@@')) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@ ?(.*)$/.exec(line);
      oldLine = hunk ? Number(hunk[1]) : 0;
      const context = hunk?.[2] ?? '';
      entry = /^exports\[`/.test(context) ? context : null;
    } else if (line.startsWith('-')) {
      if (line.startsWith('-exports[`')) entry = line.slice(1);
      file.removed.push({ text: line.slice(1), line: oldLine, entry });
      oldLine += 1;
    } else if (line.startsWith('+')) {
      file.added.push({ text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      if (line.startsWith(' exports[`')) entry = line.slice(1);
      oldLine += 1;
    }
  }
  return files;
}

function parseLog(text) {
  const commits = [];
  let current = null;
  let mode = 'message';
  for (const line of text.split('\n')) {
    const start = /^==> commit ([0-9a-f]{7,40})$/.exec(line);
    if (start) {
      current = { sha: start[1], message: [], diff: [] };
      commits.push(current);
      mode = 'message';
      continue;
    }
    if (!current) continue;
    if (line === '==> diff') {
      mode = 'diff';
      continue;
    }
    current[mode].push(line);
  }
  return commits.map((commit) => ({ sha: commit.sha, message: commit.message.join('\n').trim(), files: parseDiff(commit.diff) }));
}

const trailer = (message) => /^Gate-Change:[ \t]*(.*)$/m.exec(message)?.[1]?.trim() ?? '';

function toleranceChanges(file) {
  const before = file.removed.map((item) => TOLERANCE.exec(item.text)).filter(Boolean);
  const after = file.added.map((item) => TOLERANCE.exec(item.text)).filter(Boolean);
  const raised = [];
  for (const next of after) {
    const previous = before.find((match) => match[1] === next[1]);
    if (previous && Number(next[2]) > Number(previous[2])) raised.push({ name: next[1], from: previous[2], to: next[2] });
  }
  return raised;
}

function checkCommit(commit, context, report) {
  const short = commit.sha.slice(0, 8);
  const subject = commit.message.split('\n')[0] ?? '';
  if (GIT_GENERATED.test(subject)) return;
  const reason = trailer(commit.message);
  const golden = commit.files.filter((file) => context.isGolden(file.path) || context.isGolden(file.oldPath));
  if (golden.length > 0 && reason.length < 10) {
    const list = golden.slice(0, 3).map((file) => `${file.path} (${file.status})`).join(', ');
    report.problem({ file: golden[0].path, line: 0, rule: 'gate-change-missing', message: `commit ${short} "${subject.slice(0, 50)}" changes ${golden.length} golden file(s) without a Gate-Change trailer: ${list}`, fix: 'Amend the message with "Gate-Change: <which goldens and why, what you looked at>"; if the change was not intended, restore the goldens and fix the code.' });
  }
  for (const file of commit.files.filter((item) => /\.snap(\.(ios|android))?$/.test(item.oldPath))) {
    const changed = new Map();
    for (const item of file.removed) if (item.entry && isContractKey(item.entry, context.markers) && !changed.has(item.entry)) changed.set(item.entry, item.line);
    for (const [entry, line] of changed) {
      const key = /^exports\[`(.*?)`\]/.exec(entry)?.[1] ?? entry;
      report.problem({ file: file.oldPath, line, rule: 'contract-golden-changed', message: `commit ${short} ${file.status === 'deleted' ? 'deletes' : 'edits'} the contract golden "${key.slice(0, 140)}"`, fix: 'Revert it: every installed version must keep producing this output. Keep the code\'s output identical (renaming the title counts as a delete), or stop and ask the reviewer: ship a versioned format or a cutover from a future date.' });
    }
  }
  for (const file of commit.files) {
    for (const change of toleranceChanges(file)) {
      if (!/\bapproved\b/i.test(reason)) report.problem({ file: file.path, line: 0, rule: 'tolerance-raised', message: `commit ${short} raises ${change.name} from ${change.from} to ${change.to}`, fix: 'Restore the tolerance and fix what differs. A new tolerance needs the reviewer\'s agreement first, recorded as "Gate-Change: <name> <old> -> <new> approved by <reviewer>: <reason>".' });
    }
  }
}

function readCommits(root, options) {
  if (options.log) {
    const commits = parseLog(readFileSync(requireFile(options.log, 'log file'), 'utf8'));
    if (commits.length === 0) fail(`nothing to check: ${options.log} holds no "==> commit" blocks`, `Capture it with: git log --reverse -M -U200 -p --no-color --format='${FORMAT}' <revs>`);
    return commits;
  }
  if (options.range) {
    const commits = parseLog(git(root, ['log', '--reverse', '-M', '-U200', '-p', '--no-color', `--format=${FORMAT}`, options.range]));
    if (commits.length === 0) fail(`nothing to check: ${options.range} holds no commits`, 'Pass a range that contains commits, for example HEAD~3..HEAD.');
    return commits;
  }
  const message = options.message ? readFileSync(requireFile(options.message, 'message file'), 'utf8') : '';
  const diff = git(root, ['diff', '--cached', '-M', '-U200', '--no-color']);
  if (diff.trim() === '') fail('nothing to check: no staged change', 'Stage the change (git add) first.');
  return [{ sha: 'staged00', message: message.trim(), files: parseDiff(diff.split('\n')) }];
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const modes = [options.range, options.log, options.staged ? 'staged' : undefined].filter((value) => value !== undefined && value !== false);
  if (modes.length !== 1) fail('pass exactly one of --range <revs>, --log <file> or --staged', 'Example: --range main..HEAD');
  if (options.message && !options.staged) fail('--message goes with --staged', 'Pass --staged --message <file>, or drop --message.');
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const setup = loadGoldenSetup(root, { matcher: options.matcher, contract: options.contract });
  const globs = goldenPathGlobs(setup);
  // Installed skills and generated output are never the app's goldens (their fixtures change them on purpose).
  const ignored = (path) => isRepoScanIgnored(path, existsSync(root) ? root : null);
  const context = {
    markers: setup.contract.contractMarkers,
    isGolden: (path) => !path.includes('__diff_output__') && !ignored(path) && globs.some((glob) => matchGlob(path, glob)),
  };
  const commits = readCommits(root, options);
  const report = createReporter({ name: SPEC.name, json: options.json });
  for (const commit of commits) checkCommit({ ...commit, files: commit.files.filter((file) => !ignored(file.path) || !ignored(file.oldPath)) }, context, report);
  return report.finish({ checked: commits.length, unit: 'commits' });
});
