#!/usr/bin/env node
// check-rebaseline.mjs: proves a golden rebaseline was done the sanctioned way, from the evidence
// rebaseline.mjs wrote (reports/rebaseline/ by default) and the tree as it is now: the real assertions
// were green first, the triage named the affected set, every -u run touched one planned golden file,
// nothing but goldens changed since --start, every changed golden is in the inspection record,
// contract entries and tolerances are untouched, no orphan is left, and the whole golden project
// passed twice without -u afterwards. With --message it also checks the planned commit message.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-rebaseline.mjs [repo-root] [--message <file>]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { createReporter, fail, parseArgs, readText, run, sha256 } from './check-lib.mjs';
import {
  MIN_NOTE,
  MIN_TRAILER,
  PROOF_GOLDENS,
  VERDICTS,
  claimingTests,
  diffMaps,
  entriesDigest,
  evidencePath,
  failingContracts,
  goldenKind,
  hasJest,
  isFrozenGoldenPath,
  isGoldenTest,
  loadSetup,
  lockMismatches,
  orphanGoldens,
  plannedFiles,
  proofFiles,
  readBefore,
  readInspection,
  readJestResult,
  readJson,
  readOptionalResult,
  readProofGoldens,
  reportLockMismatches,
  snapshotEntries,
  takeInventory,
  testOfSnapshot,
  updateFiles,
} from './lib/rebaseline-lib.mjs';

const SPEC = {
  name: 'check-rebaseline',
  summary: 'Checks that a golden rebaseline followed the ritual: assertions first, triage, one planned file per -u run, nothing but goldens changed, every change inspected, contracts and tolerances untouched, no orphans, proven twice without -u.',
  usage: '[repo-root] [--message <file>] [options]',
  options: {
    'evidence-dir': { type: 'string', value: 'dir', help: 'The evidence folder (default: rn-skills.config.json "rebaselineEvidenceDir", else reports/rebaseline)' },
    message: { type: 'string', value: 'file', help: 'The planned commit message: also check its Gate-Change trailer and that it names every re-accepted file' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'The repo root is the optional positional argument (default "."). Start a rebaseline with rebaseline.mjs --start;',
    'without its before.json there is nothing to check (exit 2). NOT APPLICABLE when package.json has no jest.',
    '',
    'Rules:',
    '  assertions-first        assertions.json: every non-golden test file, green, run after --start and before the first update',
    '  triage-first            triage.json: the whole golden project without -u, after --start and before the first update',
    '  update-one-file         an update-NN.json run covered more or less than one *.golden.test.ts, or did not run with -u',
    '  update-unplanned        an updated file neither failed nor held obsolete entries in the triage',
    '  golden-changed-unlogged a golden path changed (or was deleted while its test still claims it) and no update run explains it',
    '  inspection-record       inspection.json lacks a changed golden path, lists an unchanged one, or an entry has no valid',
    `                          verdict (${Object.keys(VERDICTS).join(' | ')}) or a note of at least ${MIN_NOTE} characters`,
    '  contract-entry-changed  a [contract] snapshot entry recorded at --start changed or vanished, or an update ran on a',
    '                          file whose triage showed a failing contract assertion',
    '  tolerance-changed       the pixel matcher or contracts/goldens.json changed since --start',
    '  source-changed          any other file (code, tests, configs, the lockfile, frozen golden paths) changed since --start',
    '  install-matches-lock    node_modules differs from package-lock.json',
    '  orphan-golden           a golden snapshot whose test is gone, or a baseline PNG no golden test claims',
    '  proof-without-flag      fewer than two proof runs after the last update, or one that is red, partial, or wrote or',
    `                          updated a snapshot, or left obsolete entries; or a golden changed after the proof (${PROOF_GOLDENS})`,
    '  rebaseline-message      (--message) no "Gate-Change:" trailer in a last paragraph of trailers only, or the message',
    '                          does not name every re-accepted file',
  ].join('\n'),
};

const firstLine = (text) => text.split('\n')[0];

function checkAssertions(ctx) {
  const { report, assertions, before, firstUpdate, inventory } = ctx;
  const file = evidencePath(ctx.setup, 'assertions.json');
  const problem = (message, fix) => report.problem({ file, line: 1, rule: 'assertions-first', message, fix });
  const runIt = 'Run node <skill>/scripts/rebaseline.mjs . --assertions (every Jest project except the golden one) and fix every red test before re-accepting anything.';
  if (assertions === null) return problem('missing: the real assertions were never run in this rebaseline', runIt);
  if (assertions.startTime < before.startedAt) problem('was written before --start (an earlier session)', runIt);
  if (firstUpdate !== null && assertions.startTime > firstUpdate) problem('ran after the first update: the assertions are the gate, so they come first', 'Start over: --start --restart, then --assertions before any --update.');
  if (!assertions.success || assertions.numFailedTests > 0) problem(`is red (${assertions.numFailedTests} failed tests): a golden asserts nothing, so re-accepting over a red suite freezes the bug`, 'Stop the rebaseline, fix the code, then start over.');
  const ran = new Set(assertions.files.map((entry) => entry.path));
  const golden = assertions.files.filter((entry) => entry.path && isGoldenTest(entry.path));
  if (golden.length > 0) problem(`includes golden tests (${golden[0].path}): the assertions run is every project except the golden one`, runIt);
  const missing = inventory.assertionTests.filter((test) => !ran.has(test));
  if (missing.length > 0) problem(`left out ${missing.length} non-golden test file(s) (first: ${missing[0]}): a partial run proves nothing`, runIt);
}

function checkTriage(ctx) {
  const { report, triage, before, firstUpdate } = ctx;
  const file = evidencePath(ctx.setup, 'triage.json');
  const problem = (message, fix) => report.problem({ file, line: 1, rule: 'triage-first', message, fix });
  const runIt = 'Run node <skill>/scripts/rebaseline.mjs . --triage (the whole golden project without -u) and read every failure before any update.';
  if (triage === null) return problem('missing: the affected set was never listed', runIt);
  if (triage.startTime < before.startedAt) problem('was written before --start (an earlier session)', runIt);
  if (firstUpdate !== null && triage.startTime > firstUpdate) problem('ran after the first update, so it cannot be the plan', 'Start over: --start --restart, then --triage before any --update.');
  if (triage.snapshot.didUpdate || triage.snapshot.updated > 0 || triage.snapshot.added > 0) problem('wrote or updated snapshots: the triage runs without -u (and with --ci)', runIt);
  const ran = new Set(triage.files.map((entry) => entry.path));
  const missing = before.goldenTests.filter((test) => !ran.has(test));
  if (missing.length > 0) problem(`left out ${missing.length} golden test file(s) (first: ${missing[0]}): the triage covers the whole golden project`, runIt);
}

function checkUpdates(ctx) {
  const { report, updates, triage, setup } = ctx;
  const planned = triage === null ? null : plannedFiles(triage);
  const contracts = triage === null ? [] : failingContracts(triage, setup.markers);
  for (const update of updates) {
    const problem = (rule, message, fix) => report.problem({ file: update.file, line: 1, rule, message, fix });
    if (update.startTime < ctx.before.startedAt) problem('update-one-file', 'was written before --start (an earlier session)', 'Start over with --start --restart.');
    const files = update.files.map((entry) => entry.path);
    if (files.length !== 1 || !isGoldenTest(files[0] ?? '')) {
      problem('update-one-file', `covered ${files.length} test file(s) (${files.slice(0, 3).join(', ') || 'none'}): each -u run updates exactly one *.golden.test.ts`, 'Run rebaseline.mjs . --update <file> per file (it previews with --listTests: after --selectProjects a path is read as a project name and every golden is rewritten).');
      continue;
    }
    if (!update.snapshot.didUpdate) problem('update-one-file', `${files[0]} ran without -u, so it is not an update`, 'Use rebaseline.mjs . --update <file>; keep check runs in proof-NN.json.');
    if (planned !== null && !planned.has(files[0])) problem('update-unplanned', `${files[0]} neither failed nor held obsolete entries in the triage`, 'Revert what this run wrote (git checkout -- <its goldens>); a rebaseline re-accepts only what the triage showed failing.');
    const contract = contracts.find((entry) => entry.path === files[0]);
    if (contract) problem('contract-entry-changed', `${files[0]} was updated although the triage showed a failing contract assertion ("${contract.title.slice(0, 90)}")`, 'Revert its goldens and stop: ask the reviewer (version the format, or switch inputs from a future date). A contract entry is never re-accepted.');
  }
}

function checkGoldenChanges(ctx) {
  const { report, root, before, inventory, setup, updated, inspection } = ctx;
  const changes = diffMaps(before.goldens, inventory.goldens).map((entry) => ({ ...entry, kind: goldenKind(entry.path, setup) }));
  const allTests = [...new Set([...before.goldenTests, ...inventory.goldenTests])];
  for (const change of changes) {
    const problem = (message, fix) => report.problem({ file: change.path, line: 1, rule: 'golden-changed-unlogged', message, fix });
    if (change.kind === 'snapshot') {
      const test = testOfSnapshot(change.path);
      const testExists = test !== null && existsSync(join(root, test));
      change.orphan = change.change === 'deleted' && !testExists;
      // A header-only rewrite (a Jest major's new guide link, written by a run without -u) keeps every entry.
      change.headerOnly = change.change === 'modified' && before.snapshotDigests?.[change.path] !== undefined && before.snapshotDigests[change.path] === entriesDigest(readFileSync(join(root, change.path), 'utf8'));
      if (updated.has(test) || change.orphan || change.headerOnly) continue;
      if (change.change === 'deleted') problem(`was deleted although its test ${test} still exists, and no update run explains it`, 'Restore it (git checkout -- <path>); only orphans are deleted by hand, and obsolete entries go with --update <test>.');
      else problem(`${change.change} outside a logged update run (${test ?? 'no test'} was never updated): a hand edit or a stray -u`, `Restore it (git checkout -- ${change.path}) and re-accept it only with rebaseline.mjs . --update ${test ?? '<test>'}.`);
    } else if (change.kind === 'image') {
      const claims = claimingTests(root, change.path, allTests);
      change.orphan = change.change === 'deleted' && claims.length === 0;
      if (claims.some((test) => updated.has(test)) || change.orphan) continue;
      if (change.change === 'deleted') problem(`was deleted although ${claims[0]} still claims it, and no update run explains it`, 'Restore it (git checkout -- <path>); only baselines no test claims are deleted by hand.');
      else problem(`${change.change} outside a logged update run (${claims.length === 0 ? 'no golden test claims it' : `${claims[0]} was never updated`})`, 'Restore it and re-accept it only through rebaseline.mjs . --update <its test>.');
    }
    // Screenshot baselines are written by the E2E screenshot run (e2e-maestro), not Jest: the record proves them.
  }
  checkInspection(ctx, changes, inspection);
  return changes;
}

function checkInspection(ctx, changes, inspection) {
  const { report, setup } = ctx;
  const file = evidencePath(setup, 'inspection.json');
  const problem = (line, message, fix) => report.problem({ file, line, rule: 'inspection-record', message, fix });
  if (changes.length === 0) {
    if (inspection !== null && inspection.entries.length > 0) problem(1, `lists ${inspection.entries.length} path(s) but no golden changed since --start`, 'Empty the record: it lists exactly the goldens that changed.');
    return;
  }
  if (inspection === null) return problem(1, `missing, and ${changes.length} golden path(s) changed (first: ${changes[0].path})`, 'Look at every change (the .snap diff line by line, every PNG and its triage diff) and record each one in inspection.json (examples/inspection.json).');
  const text = readFileSync(join(ctx.root, file), 'utf8');
  const lineOfEntry = (entry) => {
    const at = text.indexOf(JSON.stringify(entry.path));
    return at < 0 ? 1 : text.slice(0, at).split('\n').length;
  };
  const byPath = new Map(inspection.entries.map((entry) => [entry.path, entry]));
  const changed = new Set(changes.map((change) => change.path));
  for (const change of changes) {
    const entry = byPath.get(change.path);
    if (!entry) {
      problem(1, `has no entry for ${change.path} (${change.change})`, `Inspect it, then add { "path": "${change.path}", "verdict": "${change.change === 'deleted' ? 'orphan' : 'intended'}", "note": "<what changed and why it is right>" }.`);
      continue;
    }
    const line = lineOfEntry(entry);
    const want = change.change === 'deleted' ? 'orphan' : 'intended';
    if (entry.verdict === 'todo' || entry.verdict === null) {
      problem(line, `${change.path}: not inspected yet (verdict ${JSON.stringify(entry.verdict)})`, `Look at it (${change.change === 'deleted' ? 'confirm no test claims it' : 'the .snap diff line by line, or the PNG and its triage diff'}), then set "verdict": "${want}" and a note, or stop if it is not what users should get.`);
    } else if (entry.verdict !== want) {
      const why = entry.verdict === 'intended' || entry.verdict === 'orphan' ? `"${entry.verdict}" does not fit a path that was ${change.change}` : `verdict ${JSON.stringify(entry.verdict)} is not a yes`;
      problem(line, `${change.path}: ${why}`, `Only "${want}" may land here. Anything else means stop: revert this path (git checkout -- ${change.path}), fix the code, start over, or ask the reviewer.`);
    }
    if (entry.note.trim().length < MIN_NOTE) problem(line, `${change.path}: the note says too little (${entry.note.trim().length} characters, at least ${MIN_NOTE})`, 'Say what changed and why it is right (for a PNG: what you saw in the triage diff and the new image).');
  }
  for (const entry of inspection.entries) {
    if (!changed.has(entry.path)) problem(lineOfEntry(entry), `lists ${entry.path}, which did not change since --start`, 'Remove the entry: the record lists exactly the goldens that changed.');
  }
}

function checkContracts(ctx) {
  const { report, root, before } = ctx;
  const cache = new Map();
  for (const recorded of before.contractEntries) {
    if (!cache.has(recorded.file)) {
      const text = existsSync(join(root, recorded.file)) ? readFileSync(join(root, recorded.file), 'utf8') : null;
      cache.set(recorded.file, text === null ? null : new Map(snapshotEntries(text).map((entry) => [entry.key, { hash: sha256(entry.body), index: entry.index, text }])));
    }
    const entries = cache.get(recorded.file);
    const now = entries?.get(recorded.key);
    const name = recorded.key.slice(0, 90);
    const fix = 'Restore the snapshot file (git checkout -- <file>) and stop: ask the reviewer. A contract entry is never re-accepted (version the format, or switch inputs from a future date).';
    if (!now) report.problem({ file: recorded.file, line: 1, rule: 'contract-entry-changed', message: `contract entry "${name}" ${entries ? 'vanished (a renamed title deletes it)' : 'vanished with its snapshot file'}`, fix });
    else if (now.hash !== recorded.sha256) report.problem({ file: recorded.file, line: now.text.slice(0, now.index).split('\n').length, rule: 'contract-entry-changed', message: `contract entry "${name}" changed since --start`, fix });
  }
}

function checkFrozen(ctx) {
  const { report, before, inventory, setup } = ctx;
  const changes = diffMaps(before.frozen, inventory.frozen);
  let reported = 0;
  for (const change of changes) {
    if (change.path === setup.matcher || change.path === setup.contractFile) {
      report.problem({ file: change.path, line: 1, rule: 'tolerance-changed', message: `${change.change} since --start: a rebaseline never touches the pixel matcher or the goldens register`, fix: 'Restore it (git checkout -- <path>). A tolerance raise needs the reviewer\'s approval first, in its own Gate-Change commit (golden-and-snapshot-tests).' });
      continue;
    }
    reported += 1;
    if (reported > 20) continue;
    const what = change.path === 'package-lock.json' || change.path === 'package.json' ? 'the dependencies changed' : isFrozenGoldenPath(change.path, setup) ? 'a frozen golden path (contracts/goldens.json goldenPaths) changed; it never changes in a rebaseline' : 'only goldens change once a rebaseline starts';
    report.problem({ file: change.path, line: 1, rule: 'source-changed', message: `${change.change} since --start: ${what}`, fix: 'Revert it, or revert the goldens re-accepted so far, make the change, and start over (--start --restart): the code under test is frozen while goldens are re-accepted.' });
  }
  if (reported > 20) report.problem({ file: setup.evidenceDir, line: 0, rule: 'source-changed', message: `and ${reported - 20} more files changed since --start`, fix: 'Start over once the code is final: --start --restart.' });
}

function checkOrphans(ctx) {
  const { report, root, inventory, setup } = ctx;
  for (const orphan of orphanGoldens(root, setup, inventory)) {
    if (orphan.kind === 'snapshot') report.problem({ file: orphan.path, line: 1, rule: 'orphan-golden', message: `belongs to ${orphan.test}, which does not exist (Jest never reports a .snap.ios or .snap.android orphan)`, fix: `Delete it (git rm ${orphan.path}) and record it in inspection.json with verdict "orphan".` });
    else report.problem({ file: orphan.path, line: 1, rule: 'orphan-golden', message: 'no golden test in the folder above claims this baseline (jest-image-snapshot never reports unused images)', fix: `Delete it (git rm ${orphan.path}) and record it with verdict "orphan"; or, when a computed identifier claims it, give the test a literal customSnapshotIdentifier prefix.` });
  }
}

function checkProof(ctx) {
  const { report, proofs, lastUpdateEnd, triage, inventory, setup } = ctx;
  const runIt = 'Run node <skill>/scripts/rebaseline.mjs . --proof (the whole golden project, --ci, no -u, twice) after the last update.';
  const after = Math.max(lastUpdateEnd ?? 0, triage?.startTime ?? 0, ctx.before.startedAt);
  const fresh = proofs.filter((proof) => proof.startTime > after);
  for (const proof of proofs.filter((entry) => entry.startTime <= after)) report.problem({ file: proof.file, line: 1, rule: 'proof-without-flag', message: 'ran before the last update (or before the triage), so it proves an older tree', fix: runIt });
  if (fresh.length < 2) report.problem({ file: evidencePath(setup, 'proof-01.json'), line: 1, rule: 'proof-without-flag', message: `${fresh.length} proof run(s) after the last update; two are needed (a golden that differs between runs reads time or randomness)`, fix: runIt });
  for (const proof of fresh) {
    const problem = (message) => report.problem({ file: proof.file, line: 1, rule: 'proof-without-flag', message, fix: runIt });
    const { snapshot } = proof;
    if (!proof.success || proof.numFailedTests > 0) problem(`is red (${proof.numFailedTests} failed tests, ${snapshot.unmatched} unmatched snapshots): the re-accepted goldens do not reproduce`);
    if (snapshot.didUpdate || snapshot.updated > 0 || snapshot.added > 0) problem(`wrote snapshots (${snapshot.updated} updated, ${snapshot.added} added): a proof runs with --ci and without -u`);
    if (snapshot.unchecked > 0) problem(`left ${snapshot.unchecked} obsolete snapshot entr${snapshot.unchecked === 1 ? 'y' : 'ies'}: remove them with --update <that file> (never the whole project)`);
    const ran = new Set(proof.files.map((entry) => entry.path));
    const missing = inventory.goldenTests.filter((test) => !ran.has(test));
    if (missing.length > 0) problem(`left out ${missing.length} golden test file(s) (first: ${missing[0]}): the proof covers the whole golden project`);
  }
  if (fresh.length < 2) return;
  // The proof covers the tree it ran against: a golden edited afterwards (by hand, or a stray -u) is unproven.
  const record = readProofGoldens(ctx.root, setup);
  const recordFile = evidencePath(setup, PROOF_GOLDENS);
  const lastProof = Math.max(...fresh.map((proof) => proof.startTime));
  if (record === null || record.writtenAt < lastProof) {
    report.problem({ file: recordFile, line: 1, rule: 'proof-without-flag', message: record === null ? 'missing: nothing records which goldens the proof ran against' : 'is older than the last proof run, so it records another tree', fix: `${runIt} Only the runner writes ${PROOF_GOLDENS}.` });
    return;
  }
  // Screenshot baselines are proven by the E2E compare run, not by this proof.
  const jestGoldens = (map) => Object.fromEntries(Object.entries(map).filter(([path]) => goldenKind(path, setup) !== 'screenshot'));
  const since = diffMaps(jestGoldens(record.goldens), jestGoldens(inventory.goldens));
  for (const change of since.slice(0, 10)) report.problem({ file: change.path, line: 1, rule: 'proof-without-flag', message: `${change.change} after the proof ran: the proof no longer covers this golden`, fix: `Restore it (git checkout -- ${change.path}); if it must change, re-accept it with rebaseline.mjs . --update <its test>, then rerun --proof.` });
  if (since.length > 10) report.problem({ file: recordFile, line: 1, rule: 'proof-without-flag', message: `and ${since.length - 10} more goldens changed after the proof ran`, fix: runIt });
}

function checkMessage(ctx, messagePath, shown, changes) {
  const { report, updated } = ctx;
  const text = readText(messagePath);
  if (text === null) fail(`--message ${shown} is not a text file`, 'Pass the file that holds the planned commit message.');
  // The same reading as the commit-msg rules (git-commits-and-reporting): the last paragraph counts as
  // trailers only when it is not the subject and every line in it is "Key: value".
  const paragraphs = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/).map((paragraph) => paragraph.split('\n').filter((line) => line.trim() !== ''));
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : [];
  const trailers = last.length > 0 && last.every((line) => /^[A-Za-z-]+:\s/.test(line)) ? last : [];
  const trailer = trailers.map((line) => /^Gate-Change:\s*(.*)$/i.exec(line)).find(Boolean);
  if (!trailer || trailer[1].trim().length < MIN_TRAILER) {
    const inProse = trailers.length === 0 && /^Gate-Change:/im.test(text);
    report.problem({ file: shown, line: 1, rule: 'rebaseline-message', message: inProse ? 'has a Gate-Change line, but not in a final paragraph of trailers only (the commit-msg hook reads it as misplaced)' : 'has no "Gate-Change: <which goldens, why, what you looked at>" trailer in its last paragraph', fix: 'End the message with a blank line and a paragraph of trailers only, holding "Gate-Change: <the cause and what you inspected>" (examples/rebaseline-commit.txt).' });
  }
  const names = [...[...updated].map((test) => posix.basename(test)), ...changes.filter((change) => change.orphan).map((change) => posix.basename(change.path))];
  const missing = names.filter((name) => !text.includes(name));
  if (missing.length > 0) report.problem({ file: shown, line: 1, rule: 'rebaseline-message', message: `does not name ${missing.length} re-accepted or deleted file(s): ${missing.slice(0, 4).join(', ')}`, fix: 'List every re-accepted golden test and every deleted orphan in the body, so the history says what moved.' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${root} has no package.json`, 'Run it from the app root, or pass the repo root.');
  const manifest = readJson(root, 'package.json', 'the manifest');
  const report = createReporter({ name: 'check-rebaseline', json: options.json });
  if (!hasJest(manifest)) return report.notApplicable('jest is not in package.json (no Jest goldens to re-accept)');
  const setup = loadSetup(root, { evidenceDir: options['evidence-dir'] });
  const before = readBefore(root, setup);
  if (before === null) fail(`nothing to check: no rebaseline in progress (${evidencePath(setup, 'before.json')} is missing)`, 'Start one with node <skill>/scripts/rebaseline.mjs . --start --reason "<cause>".');
  const messagePath = options.message ? resolve(options.message) : null;
  if (messagePath !== null && !existsSync(messagePath)) fail(`--message ${options.message} does not exist`, 'Write the planned commit message to a file first.');

  const updates = updateFiles(root, setup).map((rel) => readJestResult(root, rel));
  const updated = new Set(updates.filter((update) => update.files.length === 1 && update.snapshot.didUpdate).map((update) => update.files[0].path));
  const ctx = {
    root,
    setup,
    report,
    before,
    inventory: takeInventory(root, setup),
    assertions: readOptionalResult(root, setup, 'assertions.json'),
    triage: readOptionalResult(root, setup, 'triage.json'),
    updates,
    updated,
    proofs: proofFiles(root, setup).map((rel) => readJestResult(root, rel)),
    inspection: readInspection(root, setup),
    firstUpdate: updates.length === 0 ? null : Math.min(...updates.map((update) => update.startTime)),
    lastUpdateEnd: updates.length === 0 ? null : Math.max(...updates.map((update) => update.endTime)),
  };

  checkAssertions(ctx);
  checkTriage(ctx);
  checkUpdates(ctx);
  const changes = checkGoldenChanges(ctx);
  checkContracts(ctx);
  checkFrozen(ctx);
  const mismatches = lockMismatches(root);
  if (mismatches === null) report.note('note: no package-lock.json; compare node_modules with your lockfile by hand (pnpm install --frozen-lockfile, yarn install --immutable)');
  else reportLockMismatches(report, mismatches);
  checkOrphans(ctx);
  checkProof(ctx);
  if (messagePath !== null) checkMessage(ctx, messagePath, options.message, changes);

  const screenshots = changes.filter((change) => change.kind === 'screenshot');
  report.note(`rebaseline: "${firstLine(before.reason)}"; ${updated.size} file(s) re-accepted, ${changes.length} golden path(s) changed${screenshots.length > 0 ? ` (${screenshots.length} screenshot baseline(s): prove them with the E2E screenshot compare run, e2e-maestro)` : ''}`);
  return report.finish({ checked: Object.keys(ctx.inventory.goldens).length + changes.length, unit: 'golden paths' });
});
