#!/usr/bin/env node
// record-shipped.mjs: appends the pending schema version to contracts/schema-ledger.json once the
// first build or update carrying it leaves the machine. Dry run unless --yes; refuses while the
// ritual's rules fail. --adopt records every version an app shipped before it kept a ledger.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { contentTestProblem, entryFor, fixtureRel, LEDGER_FILE, readRepoText, ritualPaths, sha256Text } from './lib/ledger.mjs';
import { databaseFact, gitFileAt, replayChecks, requireCommit, staticChecks } from './lib/ritual.mjs';

const ADOPT_REASON = 'shipped before the schema ledger was adopted; the every-path replay covers it';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SPEC = {
  name: 'record-shipped',
  summary: 'Records the pending schema version in contracts/schema-ledger.json when its first build or update leaves the machine (dry run unless --yes).',
  usage: '[repo-root] --build <name> [options]',
  options: {
    build: { type: 'string', value: 'name', help: "The first build or update that carries the version, for example '1.4.0 (37)' (required)" },
    ref: { type: 'string', value: 'git-ref', help: 'The tag or commit the build was made from (EAS shows it on each build): hashes the files as that ref holds them, and fails when the working tree differs' },
    date: { type: 'string', value: 'YYYY-MM-DD', help: 'The day it first left the machine (default: today, local time)' },
    yes: { type: 'boolean', help: 'Write the ledger (after the developer confirmed the release); without it, only print the entry' },
    adopt: { type: 'boolean', help: 'Record every version not yet in the ledger (an app that shipped versions before it kept one)' },
    'no-replay': { type: 'boolean', help: 'Skip the node:sqlite rules before recording (not for a release)' },
    ledger: { type: 'string', value: 'file', help: 'The ledger (default: <contractsDir>/schema-ledger.json)' },
    'migrations-dir': { type: 'string', value: 'dir', help: 'The migrations folder (default: <dataDir>/migrations)' },
    'data-dir': { type: 'string', value: 'dir', help: 'Data folder (default: from resolveLayout, src/data)' },
    'test-dir': { type: 'string', value: 'dir', help: 'Root test folder (default: from resolveLayout, test)' },
    'contracts-dir': { type: 'string', value: 'dir', help: 'Contracts folder (default: from resolveLayout, contracts)' },
  },
  positionals: { min: 0, max: 1 },
  details: 'Runs the same rules as check-migration first and writes nothing while one fails. A version counts as\n' +
    'shipped when any build or update with it reaches a device outside this machine: a store or TestFlight\n' +
    'build, a Play testing track, an EAS preview build, an EAS Update.\n' +
    'With --ref, the pending step, its fixture and the migration list must be byte for byte what that ref\n' +
    'holds (rule "ref"): the ledger then pins what shipped, even when recording days after the release.',
};

/**
 * The files a recorded version stands on, compared with the release's git ref: present there (the
 * build carried the version) and equal to the working tree (the rules just ran on what shipped).
 */
function refProblems(root, paths, ref, pending) {
  const files = [paths.list, ...pending.flatMap((step) => [step.rel, fixtureRel(paths, step.version)])];
  const versionOf = (rel) => pending.find((step) => rel === step.rel || rel === fixtureRel(paths, step.version))?.version ?? pending.at(-1).version;
  return files.flatMap((rel) => {
    const shipped = gitFileAt(root, ref, rel);
    if (shipped === null) return [{ file: rel, rule: 'ref', message: `${rel} is not in ${ref}: the build made from it does not carry version ${versionOf(rel)}`, fix: 'Pass the ref the release was built from (its commit in EAS, or its tag). A build without the step did not ship the version: record it with the release that carries it.' }];
    const local = readRepoText(root, rel);
    if (local !== null && sha256Text(local) === sha256Text(shipped)) return [];
    return [{ file: rel, rule: 'ref', message: `${rel} differs from ${ref}: recording now would pin bytes that never shipped`, fix: `Record from the release's bytes: git stash or git checkout ${ref} -- ${rel}, then rerun. A change made after the release belongs in a new version.` }];
  });
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to record: no package.json in ${root}`, 'Run from the app repo root, or pass it: node record-shipped.mjs <repo-root> --build <name>.');
  const paths = ritualPaths(root, options);
  const fact = databaseFact(root, paths);
  if (fact !== null) fail(`nothing to record: ${fact}`, 'record-shipped is for apps with a versioned SQLite database.');
  if (typeof options.build !== 'string' || options.build.trim() === '') fail('--build is required', "Name the first build or update that carries the version: --build '1.4.0 (37)'.");
  const date = options.date ?? today();
  if (!DATE.test(date)) fail(`--date ${date} is not YYYY-MM-DD`, 'For example --date 2026-10-14.');

  const report = createReporter({ name: SPEC.name });
  const ctx = { root, paths, add: (problem) => report.problem({ line: 1, ...problem }), skip: (entry) => report.skip(entry), note: (text) => report.note(text) };
  const ledgerMissing = !existsSync(join(root, paths.ledger));
  if (ledgerMissing && !options.adopt) fail(`${paths.ledger} does not exist`, `Copy templates/contracts/${LEDGER_FILE} first; for an app that already shipped versions, run with --adopt.`);
  // A missing ledger is what --adopt creates; its rule must not block the run that creates it.
  const silenced = ledgerMissing ? { ...ctx, add: (problem) => (problem.rule === 'ledger' ? undefined : ctx.add(problem)) } : ctx;
  const { steps, shipped, pending } = staticChecks(silenced, { adopt: options.adopt });
  let runs = 0;
  if (options['no-replay']) report.note('node:sqlite rules skipped (--no-replay): not a release check');
  else runs = await replayChecks(silenced);
  if (report.count > 0) return report.finish({ checked: steps.length + runs, unit: 'versions and replays' });

  if (pending.length === 0) {
    report.note(`nothing to record: every version up to v${steps.length} is in ${paths.ledger}`);
    return report.finish({ checked: steps.length + runs, unit: 'versions and replays' });
  }
  let read;
  if (options.ref !== undefined) {
    requireCommit(root, options.ref, '--ref');
    for (const problem of refProblems(root, paths, options.ref, pending)) report.problem({ line: 1, ...problem });
    if (report.count > 0) return report.finish({ checked: steps.length + runs, unit: 'versions and replays' });
    read = (rel) => gitFileAt(root, options.ref, rel);
    report.note(`hashed as ${options.ref} holds them (the working tree matches)`);
  } else {
    report.note('no --ref: hashed the working tree; pass --ref <the commit or tag the build was made from> so the ledger pins what shipped');
  }
  const entries = pending.map((step) => {
    const entry = entryFor(root, paths, step, { build: options.build, date, read });
    if (options.adopt && step.version >= 2 && contentTestProblem(root, paths, step) !== null) entry.contentTest = ADOPT_REASON;
    return entry;
  });
  const describe = (verb) => {
    for (const entry of entries) {
      report.note(`${verb} v${entry.version} ${entry.name}: step ${entry.stepSha256.slice(0, 12)}, fixture ${entry.fixtureSha256.slice(0, 12)}, first shipped in ${entry.firstShippedIn} on ${entry.shippedOn}${entry.contentTest === undefined ? '' : ' (no content test: shipped before the ledger)'}`);
    }
  };
  if (!options.yes) {
    describe('WOULD RECORD');
    report.note(`STOP: once a build or update with v${entries.at(-1).version} reaches any device, the version and its step are permanent. Ask the developer to confirm the release, then rerun with --yes.`);
    return report.finish({ checked: steps.length + runs, unit: 'versions and replays' });
  }
  const ledger = ledgerMissing
    ? { $schema: `./${LEDGER_FILE.replace('.json', '.schema.json')}`, shipped: [] }
    : JSON.parse(readFileSync(join(root, paths.ledger), 'utf8'));
  if (ledgerMissing && !existsSync(join(root, paths.layout.contractsDir, LEDGER_FILE.replace('.json', '.schema.json')))) delete ledger.$schema;
  ledger.shipped = [...shipped, ...entries];
  // --adopt in an app without a contracts folder yet: the ledger is the first file in it.
  mkdirSync(dirname(join(root, paths.ledger)), { recursive: true });
  writeFileSync(join(root, paths.ledger), `${JSON.stringify(ledger, null, 2)}\n`);
  describe('RECORDED');
  report.note(`${paths.ledger} now lists v1..v${ledger.shipped.length}; commit it with the release (it is reviewed like a fixture).`);
  return report.finish({ checked: steps.length + runs, unit: 'versions and replays' });
});
