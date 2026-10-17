#!/usr/bin/env node
// rebaseline.mjs: runs each step of the golden rebaseline ritual and writes its evidence (default
// reports/rebaseline/, git-ignored) for check-rebaseline.mjs. Exactly one mode per run, in this order:
//   --start --reason "<cause>"   record every golden, every other file and every contract entry
//   --assertions                 every Jest project except the golden one, with --ci (must be green)
//   --triage                     the whole golden project with --ci, no -u: the affected set (the plan)
//   --update <file>              one planned golden test: --listTests preview, then --ci -u on that file
//   --proof                      the whole golden project with --ci, no -u, twice
// It never commits, never deletes a golden and never runs -u on more than one file.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/rebaseline.mjs [repo-root] --start --reason "<cause>"

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, posix, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, run, toPosix, walkRepo } from './check-lib.mjs';
import {
  EVIDENCE_VERSION,
  MIN_REASON,
  PROOF_GOLDENS,
  TRACK_OBSOLETE_VAR,
  contractEntries,
  contractKeysIn,
  diffMaps,
  evidencePath,
  failingContracts,
  goldenKind,
  hasJest,
  isGoldenTest,
  loadSetup,
  lockMismatches,
  nextNumbered,
  orphanGoldens,
  parsePorcelain,
  plannedFiles,
  proofFiles,
  readBefore,
  readInspection,
  readJestResult,
  readJson,
  readOptionalResult,
  repoRelative,
  reportLockMismatches,
  snapshotDigests,
  takeInventory,
  updateFiles,
} from './lib/rebaseline-lib.mjs';

const MODES = ['start', 'assertions', 'triage', 'update', 'proof'];
const SPEC = {
  name: 'rebaseline',
  summary: 'Runs one step of the golden rebaseline ritual (start, assertions, triage, one-file update, proof) and writes its evidence for check-rebaseline.mjs.',
  usage: '[repo-root] (--start --reason <text> | --assertions | --triage | --update <file> | --proof) [options]',
  options: {
    start: { type: 'boolean', help: 'Record the inventory (before.json); refuses a stale install or uncommitted goldens' },
    reason: { type: 'string', value: 'text', help: 'With --start: the cause of the rebaseline (a dependency bump, a token change, an intended redesign)' },
    restart: { type: 'boolean', help: 'With --start: discard the evidence of an unfinished rebaseline first' },
    'dry-run': { type: 'boolean', help: 'With --start: run every start check and print the inventory, write nothing' },
    'git-status': { type: 'string', value: 'file', help: 'With --start: read a captured `git status --porcelain=v1` instead of running git' },
    assertions: { type: 'boolean', help: 'Run every Jest project except the golden one (--ignoreProjects <golden>) into assertions.json' },
    triage: { type: 'boolean', help: 'Run the whole golden project without -u into triage.json, keep its diff images, print the plan' },
    update: { type: 'string', value: 'file', help: 'Re-accept one planned golden test file (preview with --listTests, then --ci -u) into update-NN.json' },
    proof: { type: 'boolean', help: 'Run the whole golden project without -u twice into proof-01.json and proof-02.json' },
    'evidence-dir': { type: 'string', value: 'dir', help: 'The evidence folder (default: rn-skills.config.json "rebaselineEvidenceDir", else reports/rebaseline)' },
    'golden-project': { type: 'string', value: 'name', help: 'The golden Jest project (default: "goldenProject", else golden)' },
    'diff-dir': { type: 'string', value: 'dir', help: 'With --triage: where the pixel matcher writes diff images (default: "pixelDiffDir", else reports/visual/diff)' },
    jest: { type: 'string', value: 'command', help: 'How to start Jest, words split on spaces (default: npx jest)' },
    'max-workers': { type: 'string', value: 'n', help: 'Pass --maxWorkers=<n> to Jest (shared machines: 2)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'The repo root is the optional positional argument (default "."). Evidence lands in reports/rebaseline/ (git-ignored).',
    'NOT APPLICABLE when package.json has no jest.',
    '',
    'Problems it refuses on (exit 1, nothing run or written):',
    '  install-matches-lock    (--start) node_modules differs from package-lock.json: run npm ci first',
    '  goldens-dirty-at-start  (--start) a golden path has uncommitted changes: commit or revert them first',
    '  assertions-first        (--assertions) the run is red or partial; (--triage, --update) assertions.json is missing or red',
    '  triage-first            (--update) triage.json is missing; (--assertions, --triage) an update already ran',
    '  contract-entry-changed  (--start) an orphan snapshot holds [contract] entries; (--triage, --update) a [contract]',
    '                          assertion fails: stop and ask the reviewer',
    '  update-unplanned        (--update) the file neither failed nor held obsolete entries in the triage',
    '  update-one-file         (--update) the --listTests preview lists anything but that one file, or',
    `                          ${TRACK_OBSOLETE_VAR} is set (the outdated-snapshot reporter would delete other tests' baselines)`,
    '  update-red              (--update) the -u run is still red (a non-snapshot assertion fails)',
    '  proof-without-flag      (--proof) a proof run is red, partial, wrote a snapshot or left obsolete entries',
  ].join('\n'),
};

function jestCommand(options) {
  const words = (options.jest ?? 'npx jest').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) fail('--jest is empty', 'Pass the command that starts Jest, for example "npx jest".');
  return words;
}

function spawnJest(root, options, args, { capture = false } = {}) {
  const [command, ...rest] = jestCommand(options);
  const workers = options['max-workers'];
  if (workers !== undefined && !/^\d+%?$/.test(workers)) fail(`--max-workers "${workers}" is not a number or a percentage`, 'Pass for example --max-workers 2.');
  const all = [...rest, ...args, ...(workers !== undefined && !args.includes('--listTests') ? [`--maxWorkers=${workers}`] : [])];
  const shown = [command, ...all].join(' ');
  if (!capture) console.log(`$ ${shown}`);
  const result = spawnSync(command, all, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) fail(`could not start Jest (${shown}): ${result.error.message}`, 'Install the dependencies (npm ci) or pass --jest "<command>".');
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', shown };
}

function runToResult(root, options, args, rel) {
  rmSync(join(root, rel), { force: true });
  const outcome = spawnJest(root, options, [...args, '--json', '--outputFile', join(root, rel)]);
  if (!existsSync(join(root, rel))) fail(`Jest wrote no result to ${rel} (${outcome.shown} exited ${outcome.status})`, 'Read the Jest output above (a config or syntax error stops it before any test runs), fix it, and rerun this step.');
  return readJestResult(root, rel);
}

function requireBefore(root, setup) {
  const before = readBefore(root, setup);
  if (before === null) fail(`no rebaseline in progress (${evidencePath(setup, 'before.json')} is missing)`, 'Start one first: rebaseline.mjs . --start --reason "<cause>".');
  return before;
}

function gitDirtyGoldens(root, setup, options, report) {
  let text;
  if (options['git-status']) {
    const file = resolve(options['git-status']);
    if (!existsSync(file)) fail(`--git-status ${options['git-status']} does not exist`, 'Capture it with git status --porcelain=v1 --untracked-files=all > status.txt.');
    text = readFileSync(file, 'utf8');
  } else {
    const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const prefix = git(['rev-parse', '--show-prefix']);
    const probe = git(['status', '--porcelain=v1', '--untracked-files=all', '--', '.']);
    if (prefix.error || prefix.status !== 0 || probe.status !== 0) {
      report.note('note: not a git repository (or git is missing): uncommitted goldens could not be checked');
      return;
    }
    // Porcelain paths are relative to the git top level; the app may sit below it (a workspace).
    const below = prefix.stdout.trim();
    text = probe.stdout.split('\n').map((line) => (below && line.slice(3).startsWith(below) ? `${line.slice(0, 3)}${line.slice(3 + below.length)}` : line)).join('\n');
  }
  for (const entry of parsePorcelain(text)) {
    if (goldenKind(entry.path, setup) === null) continue;
    report.problem({ file: entry.path, line: 1, rule: 'goldens-dirty-at-start', message: `has uncommitted changes (${entry.status.trim() || 'changed'}): the record must start from the committed goldens`, fix: `Commit the change that made it (with its Gate-Change trailer) or revert it (git checkout -- ${entry.path}), then start.` });
  }
}

function start(root, setup, options, report) {
  const reason = (options.reason ?? '').trim();
  if (reason.length < MIN_REASON) fail(`--start needs --reason "<cause>" of at least ${MIN_REASON} characters`, 'Name the cause, for example --reason "@shopify/react-native-skia 2.6.2 -> 2.7.0 changes anti-aliasing".');
  const beforeRel = evidencePath(setup, 'before.json');
  const dryRun = options['dry-run'] === true;
  if (existsSync(join(root, beforeRel)) && !dryRun) {
    if (!options.restart) fail(`a rebaseline is already in progress (${beforeRel} exists)`, 'Finish it (check-rebaseline.mjs), or pass --restart to discard its evidence and start over.');
    rmSync(join(root, setup.evidenceDir), { recursive: true, force: true });
  }
  if (dryRun && options.restart) fail('--dry-run writes and deletes nothing, so --restart has no meaning with it', 'Drop --restart.');
  const inventory = takeInventory(root, setup);
  if (inventory.goldenTests.length === 0) fail('nothing to rebaseline: the repo has no *.golden.test.ts file', 'Write goldens first (golden-and-snapshot-tests); this ritual re-accepts existing ones.');
  const mismatches = lockMismatches(root);
  if (mismatches === null) report.note('note: no package-lock.json; make sure the install matches your lockfile (pnpm install --frozen-lockfile, yarn install --immutable)');
  else reportLockMismatches(report, mismatches);
  gitDirtyGoldens(root, setup, options, report);
  const orphans = [];
  for (const orphan of orphanGoldens(root, setup, inventory)) {
    const keys = orphan.kind === 'snapshot' ? contractKeysIn(root, orphan.path, setup.markers) : [];
    if (keys.length === 0) {
      orphans.push(orphan);
      continue;
    }
    // Deleting it would remove contract entries, keeping it is an orphan: the ritual has no finish, so it is settled first.
    report.problem({ file: orphan.path, line: 1, rule: 'contract-entry-changed', message: `is an orphan (${orphan.test} is gone) holding ${keys.length} contract entr${keys.length === 1 ? 'y' : 'ies'} ("${keys[0].slice(0, 80)}"): a rebaseline can neither delete nor keep it`, fix: 'Settle it before starting, with the reviewer: restore or move the test so it claims the snapshot again (golden-and-snapshot-tests\' one-file flow), or retire the contract in its own reviewed commit; then --start.' });
  }
  if (orphans.length > 0) report.note(`orphans to delete during this rebaseline (git rm, then record them as "orphan"):\n  ${orphans.map((orphan) => orphan.path).join('\n  ')}`);
  if (process.env[TRACK_OBSOLETE_VAR]) report.note(`note: ${TRACK_OBSOLETE_VAR} is set: unset it for the whole ritual (each one-file -u run would let the outdated-snapshot reporter delete the other tests' baselines); --update refuses while it is set`);
  if (report.count > 0) return report.finish({ checked: Object.keys(inventory.goldens).length, unit: 'golden paths' });
  const record = {
    $comment: 'Written by run-goldens-rebaseline rebaseline.mjs --start; read by check-rebaseline.mjs. Do not edit: start over with --start --restart.',
    version: EVIDENCE_VERSION,
    startedAt: Date.now(),
    reason,
    goldenProject: setup.goldenProject,
    goldenTests: inventory.goldenTests,
    contractEntries: contractEntries(root, setup, inventory.goldens),
    snapshotDigests: snapshotDigests(root, setup, inventory.goldens),
    goldens: inventory.goldens,
    frozen: inventory.frozen,
  };
  const counts = `${Object.keys(inventory.goldens).length} golden paths, ${inventory.goldenTests.length} golden test files, ${record.contractEntries.length} contract entries and ${Object.keys(inventory.frozen).length} frozen files`;
  if (dryRun) {
    report.note(`dry run: would record ${counts}; nothing written`);
    return report.finish({ checked: Object.keys(inventory.goldens).length, unit: 'golden paths' });
  }
  mkdirSync(join(root, setup.evidenceDir), { recursive: true });
  writeFileSync(join(root, beforeRel), `${JSON.stringify(record, null, 2)}\n`);
  report.note(`recorded ${counts} in ${beforeRel}`);
  report.note('Next: rebaseline.mjs . --assertions (from now on only goldens may change)');
  return report.finish({ checked: Object.keys(inventory.goldens).length, unit: 'golden paths' });
}

function assertionsStep(root, setup, options, report) {
  const before = requireBefore(root, setup);
  if (updateFiles(root, setup).length > 0) {
    report.problem({ file: evidencePath(setup, 'update-01.json'), line: 1, rule: 'triage-first', message: 'updates already ran: the assertions belong before the first update', fix: 'Start over: --start --restart.' });
    return report.finish({ checked: 1, unit: 'runs' });
  }
  const result = runToResult(root, options, ['--ci', '--ignoreProjects', setup.goldenProject], evidencePath(setup, 'assertions.json'));
  const inventory = takeInventory(root, setup);
  const ran = new Set(result.files.map((file) => file.path));
  const missing = inventory.assertionTests.filter((test) => !ran.has(test));
  const fix = 'Fix the code until every non-golden test passes, then start over (--start --restart): re-accepting goldens over a red suite freezes the bug.';
  if (!result.success || result.numFailedTests > 0) report.problem({ file: result.file, line: 1, rule: 'assertions-first', message: `red: ${result.numFailedTests} failed tests`, fix });
  if (missing.length > 0) report.problem({ file: result.file, line: 1, rule: 'assertions-first', message: `left out ${missing.length} non-golden test file(s) (first: ${missing[0]})`, fix: 'Check the Jest projects: every project except the golden one must run (pass --golden-project when it is not "golden").' });
  if (result.files.some((file) => file.path && isGoldenTest(file.path))) report.problem({ file: result.file, line: 1, rule: 'assertions-first', message: 'ran golden tests: the golden project name is wrong', fix: 'Pass --golden-project <displayName of the golden Jest project>.' });
  if (report.count === 0) report.note(`assertions green: ${result.numTotalTests} tests in ${result.files.length} files (reason: ${before.reason}). Next: rebaseline.mjs . --triage`);
  return report.finish({ checked: result.files.length, unit: 'test files' });
}

function keepTriageDiffs(root, setup, options, since) {
  const diffDir = repoRelative(options['diff-dir'] ?? setup.layout.config?.pixelDiffDir ?? 'reports/visual/diff', 'the diff folder');
  const found = [];
  const dirAbs = join(root, diffDir);
  if (existsSync(dirAbs)) found.push(...walkRepo(dirAbs, { include: ['*.png'] }).map((rel) => join(dirAbs, rel)));
  found.push(...walkRepo(root, { include: ['**/__diff_output__/*.png'] }).map((rel) => join(root, rel)));
  const kept = [];
  for (const abs of found) {
    if (statSync(abs).mtimeMs + 1000 < since) continue;
    const target = evidencePath(setup, `triage-diffs/${basename(abs)}`);
    mkdirSync(join(root, posix.dirname(target)), { recursive: true });
    copyFileSync(abs, join(root, target));
    kept.push(target);
  }
  return kept;
}

function triageStep(root, setup, options, report) {
  const before = requireBefore(root, setup);
  const assertions = readOptionalResult(root, setup, 'assertions.json');
  if (assertions === null || !assertions.success) {
    report.problem({ file: evidencePath(setup, 'assertions.json'), line: 1, rule: 'assertions-first', message: assertions === null ? 'missing: run --assertions first' : 'red: fix the code and start over', fix: 'rebaseline.mjs . --assertions must be green before the triage.' });
    return report.finish({ checked: 1, unit: 'runs' });
  }
  if (updateFiles(root, setup).length > 0) {
    report.problem({ file: evidencePath(setup, 'update-01.json'), line: 1, rule: 'triage-first', message: 'updates already ran, so a new triage cannot be the plan', fix: 'Start over: --start --restart.' });
    return report.finish({ checked: 1, unit: 'runs' });
  }
  const startedAt = Date.now();
  const result = runToResult(root, options, ['--ci', '--selectProjects', setup.goldenProject], evidencePath(setup, 'triage.json'));
  const kept = keepTriageDiffs(root, setup, options, startedAt);
  const planned = [...plannedFiles(result)].sort();
  for (const contract of failingContracts(result, setup.markers)) {
    report.problem({ file: contract.path ?? result.file, line: 1, rule: 'contract-entry-changed', message: `a contract golden fails: "${contract.title.slice(0, 100)}"`, fix: 'Stop and ask the reviewer: contract entries are never re-accepted. Fix the code so it reproduces the old output, or version the format.' });
  }
  const missing = before.goldenTests.filter((test) => !result.files.some((file) => file.path === test));
  if (missing.length > 0) report.problem({ file: result.file, line: 1, rule: 'triage-first', message: `left out ${missing.length} golden test file(s) (first: ${missing[0]})`, fix: 'Pass --golden-project <displayName> so the whole golden project runs.' });
  report.note(`plan: ${planned.length} golden test file(s) to re-accept${planned.length > 0 ? `:\n  ${planned.join('\n  ')}` : ' (the golden project is green: nothing to re-accept)'}`);
  if (result.unchecked.length > 0) report.note(`obsolete entries (renamed or removed tests): ${result.unchecked.map((entry) => `${entry.path} (${entry.keys.length})`).join(', ')}`);
  if (kept.length > 0) report.note(`diff images kept (an update deletes the originals); open every one:\n  ${kept.join('\n  ')}`);
  if (report.count === 0 && planned.length > 0) report.note('Next: read every failure above, explain each by the cause, then stop and ask the developer for the go-ahead on this plan before the first --update.');
  return report.finish({ checked: result.files.length, unit: 'golden test files' });
}

function mergeInspection(root, setup, before) {
  const inventory = takeInventory(root, setup);
  const changes = diffMaps(before.goldens, inventory.goldens);
  const rel = evidencePath(setup, 'inspection.json');
  const current = readInspection(root, setup);
  const data = current?.data ?? { $comment: 'One entry per changed golden path. verdict: "intended" (changed or added, and right) or "orphan" (deleted, no test claims it). note: what changed and why it is right. Anything else: stop.', entries: [] };
  const changed = new Map(changes.map((change) => [change.path, change.change]));
  data.entries = data.entries.filter((entry) => changed.has(entry.path) || entry.verdict !== 'todo');
  for (const entry of data.entries) if (changed.has(entry.path)) entry.change = changed.get(entry.path);
  for (const [path, change] of changed) if (!data.entries.some((entry) => entry.path === path)) data.entries.push({ path, change, verdict: 'todo', note: '' });
  writeFileSync(join(root, rel), `${JSON.stringify(data, null, 2)}\n`);
  return { rel, changes };
}

function updateStep(root, setup, options, report) {
  const before = requireBefore(root, setup);
  const file = repoRelative(options.update, '--update');
  if (!isGoldenTest(file) || !existsSync(join(root, file))) fail(`--update ${file} is not an existing *.golden.test.ts file`, 'Pass one golden test file from the triage plan, path relative to the repo root.');
  const assertions = readOptionalResult(root, setup, 'assertions.json');
  const triage = readOptionalResult(root, setup, 'triage.json');
  if (assertions === null || !assertions.success) report.problem({ file: evidencePath(setup, 'assertions.json'), line: 1, rule: 'assertions-first', message: assertions === null ? 'missing' : 'red', fix: 'rebaseline.mjs . --assertions must be green before any update.' });
  if (triage === null) report.problem({ file: evidencePath(setup, 'triage.json'), line: 1, rule: 'triage-first', message: 'missing: no plan to update from', fix: 'Run rebaseline.mjs . --triage first.' });
  if (triage !== null) {
    if (!plannedFiles(triage).has(file)) report.problem({ file, line: 1, rule: 'update-unplanned', message: 'neither failed nor held obsolete entries in the triage', fix: 'Update only files in the triage plan; a passing golden has nothing to re-accept.' });
    const contract = failingContracts(triage, setup.markers).find((entry) => entry.path === file);
    if (contract) report.problem({ file, line: 1, rule: 'contract-entry-changed', message: `holds a failing contract assertion ("${contract.title.slice(0, 90)}"): -u would rewrite it`, fix: 'Stop and ask the reviewer; never re-accept a contract entry.' });
  }
  if (process.env[TRACK_OBSOLETE_VAR]) report.problem({ file, line: 1, rule: 'update-one-file', message: `${TRACK_OBSOLETE_VAR} is set: with jest-image-snapshot's outdated-snapshot reporter configured, a one-file -u run deletes every untouched -snap.png in the folders it touched (other tests' live baselines)`, fix: `Unset it for the whole ritual (unset ${TRACK_OBSOLETE_VAR}) and delete orphans by hand (git rm), then rerun this update.` });
  if (report.count > 0) return report.finish({ checked: 1, unit: 'files' });
  const preview = spawnJest(root, options, [file, '--selectProjects', setup.goldenProject, '--listTests'], { capture: true });
  const listed = `${preview.stdout}\n${preview.stderr}`.split('\n').map((line) => line.trim()).filter((line) => /\.(?:[cm]?[jt]sx?)$/.test(line) && !/^Running\b/.test(line)).map((line) => readJestPath(root, line));
  if (listed.length !== 1 || listed[0] !== file) {
    report.problem({ file, line: 1, rule: 'update-one-file', message: `the --listTests preview listed ${listed.length} file(s) (${listed.slice(0, 3).join(', ') || 'none'}), not just this one`, fix: 'Put the path first (jest <file> --selectProjects golden ...); check the Jest config and the golden project name. Nothing was written.' });
    return report.finish({ checked: 1, unit: 'files' });
  }
  const result = runToResult(root, options, [file, '--selectProjects', setup.goldenProject, '--ci', '-u'], nextNumbered(root, setup, 'update'));
  if (result.files.length !== 1) report.problem({ file: result.file, line: 1, rule: 'update-one-file', message: `the run covered ${result.files.length} files`, fix: 'Revert what it wrote (git checkout -- <goldens>) and start over.' });
  if (!result.success) report.problem({ file, line: 1, rule: 'update-red', message: `still red after -u (${result.numFailedTests} failed): a non-snapshot assertion fails`, fix: 'Revert what this run wrote, stop, fix the code, and start over (--start --restart).' });
  const { rel, changes } = mergeInspection(root, setup, before);
  const howTo = (change) => (change.change === 'deleted' ? 'deleted' : goldenKind(change.path, setup) === 'snapshot' ? `git diff -- ${change.path}` : `open ${change.path} and its triage diff`);
  report.note(`updated ${file}: ${result.snapshot.updated} updated, ${result.snapshot.added} written, ${result.unchecked.reduce((sum, entry) => sum + entry.keys.length, 0)} obsolete removed`);
  report.note(`golden paths changed since --start (${changes.length}); inspect each and fill its entry in ${rel}:\n  ${changes.map((change) => `${change.path} (${howTo(change)})`).join('\n  ') || 'none'}`);
  return report.finish({ checked: 1, unit: 'files' });
}

/** A path printed by jest --listTests (absolute) as a repo-relative path. */
function readJestPath(root, line) {
  if (!isAbsolute(line)) return toPosix(line).replace(/^\.\//, '');
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  for (const base of [...new Set([root, real(root)])]) {
    for (const candidate of [...new Set([line, real(line)])]) {
      const rel = toPosix(relative(base, candidate));
      if (!rel.startsWith('..') && !isAbsolute(rel)) return rel;
    }
  }
  return toPosix(line);
}

function proofStep(root, setup, options, report) {
  requireBefore(root, setup);
  if (readOptionalResult(root, setup, 'triage.json') === null) {
    report.problem({ file: evidencePath(setup, 'triage.json'), line: 1, rule: 'triage-first', message: 'missing: run --triage first', fix: 'Follow the order: --assertions, --triage, --update <file> per planned file, --proof.' });
    return report.finish({ checked: 1, unit: 'runs' });
  }
  for (const rel of [...proofFiles(root, setup), evidencePath(setup, PROOF_GOLDENS)]) rmSync(join(root, rel), { force: true });
  const inventory = takeInventory(root, setup);
  let checked = 0;
  for (const name of ['proof-01.json', 'proof-02.json']) {
    const result = runToResult(root, options, ['--ci', '--selectProjects', setup.goldenProject], evidencePath(setup, name));
    checked += result.files.length;
    const problem = (message) => report.problem({ file: result.file, line: 1, rule: 'proof-without-flag', message, fix: 'A red proof means the re-accepted goldens do not reproduce: find what reads time, randomness or the machine (golden-and-snapshot-tests), revert, fix, start over.' });
    if (!result.success) problem(`red: ${result.numFailedTests} failed tests, ${result.snapshot.unmatched} unmatched, ${result.snapshot.unchecked} obsolete snapshots`);
    if (result.snapshot.didUpdate || result.snapshot.updated > 0 || result.snapshot.added > 0) problem('wrote snapshots: a proof never writes');
    const missing = inventory.goldenTests.filter((test) => !result.files.some((file) => file.path === test));
    if (missing.length > 0) problem(`left out ${missing.length} golden test file(s) (first: ${missing[0]})`);
  }
  // The Jest goldens the proof ran against (screenshot baselines are the E2E run's): check-rebaseline fails when
  // one changes afterwards (a hand edit, a stray -u).
  const jestGoldens = Object.fromEntries(Object.entries(inventory.goldens).filter(([path]) => goldenKind(path, setup) !== 'screenshot'));
  writeFileSync(join(root, evidencePath(setup, PROOF_GOLDENS)), `${JSON.stringify({ $comment: 'Written by rebaseline.mjs --proof: the golden hashes the proof ran against. Do not edit; rerun --proof.', writtenAt: Date.now(), goldens: jestGoldens }, null, 2)}\n`);
  report.note(`recorded the ${Object.keys(jestGoldens).length} golden hashes the proof ran against in ${evidencePath(setup, PROOF_GOLDENS)}`);
  if (report.count === 0) report.note('proof: the whole golden project passed twice without -u. Next: check-rebaseline.mjs .');
  return report.finish({ checked, unit: 'golden test files' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const chosen = MODES.filter((mode) => options[mode] !== undefined && options[mode] !== false);
  if (chosen.length !== 1) fail(chosen.length === 0 ? 'choose one step' : `choose one step, not ${chosen.map((mode) => `--${mode}`).join(' and ')}`, 'Pass exactly one of --start --reason "<cause>", --assertions, --triage, --update <file>, --proof.');
  const root = resolve(positionals[0] ?? '.');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to do: ${root} has no package.json`, 'Run it from the app root, or pass the repo root.');
  const report = createReporter({ name: `rebaseline --${chosen[0]}`, json: options.json });
  if (!hasJest(readJson(root, 'package.json', 'the manifest'))) return report.notApplicable('jest is not in package.json (no Jest goldens to re-accept)');
  const setup = loadSetup(root, { evidenceDir: options['evidence-dir'], goldenProject: options['golden-project'] });
  const step = { start, assertions: assertionsStep, triage: triageStep, update: updateStep, proof: proofStep }[chosen[0]];
  return step(root, setup, options, report);
});
