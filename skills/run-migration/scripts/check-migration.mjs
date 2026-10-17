#!/usr/bin/env node
// check-migration.mjs: proves the release ritual for a schema migration in one app repo: the schema
// ledger, frozen shipped steps and fixtures, one pending version, its content test and hostile rows,
// the Jest proofs, and on node:sqlite every from-to path and the forced-failure restore drill.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { ritualPaths } from './lib/ledger.mjs';
import { databaseFact, replayChecks, RULES, staticChecks } from './lib/ritual.mjs';

const SPEC = {
  name: 'check-migration',
  summary: 'Checks the release ritual for a SQLite schema migration (ledger, frozen shipped steps, one pending version, content test, every from-to path, restore drill).',
  usage: '[repo-root] [options]',
  options: {
    base: { type: 'string', value: 'git-ref', help: 'Compare the ledger with this ref (CI: the target branch); a changed or removed entry fails' },
    'base-ledger': { type: 'string', value: 'file', help: 'Compare the ledger with this file instead of a git ref' },
    'no-replay': { type: 'boolean', help: 'Skip the node:sqlite rules (every-path, restore-drill)' },
    ledger: { type: 'string', value: 'file', help: 'The ledger (default: <contractsDir>/schema-ledger.json)' },
    'migrations-dir': { type: 'string', value: 'dir', help: 'The migrations folder (default: <dataDir>/migrations)' },
    'open-path': { type: 'string', value: 'file', help: 'The module exporting openAppDatabase (default: <dataDir>/app-database.ts, or the ledger "openPath")' },
    'data-dir': { type: 'string', value: 'dir', help: 'Data folder (default: from resolveLayout, src/data)' },
    'test-dir': { type: 'string', value: 'dir', help: 'Root test folder (default: from resolveLayout, test)' },
    'contracts-dir': { type: 'string', value: 'dir', help: 'Contracts folder (default: from resolveLayout, contracts)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: `Rules:\n${Object.entries(RULES).map(([rule, meaning]) => `  ${rule.padEnd(19)}${meaning}`).join('\n')}\n` +
    'NOT APPLICABLE when the app has no src/data/migrations/migrations.ts. SKIP for restore-drill only while\n' +
    'src/data/app-database.ts is not yet created (persistence-and-migrations creates it).',
};

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: no package.json in ${root}`, 'Run from the app repo root, or pass it: node check-migration.mjs <repo-root>.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const paths = ritualPaths(root, options);
  const fact = databaseFact(root, paths);
  if (fact !== null) return report.notApplicable(fact);

  const ctx = {
    root,
    paths,
    add: (problem) => report.problem({ line: 1, ...problem }),
    skip: (entry) => report.skip(entry),
    note: (text) => report.note(text),
  };
  const { steps, ledger, unlisted } = staticChecks(ctx, options);
  let runs = 0;
  if (options['no-replay']) report.note('node:sqlite rules skipped (--no-replay): every-path and restore-drill did not run');
  else {
    const openPath = options['open-path'] ?? (typeof ledger.data?.openPath === 'string' ? ledger.data.openPath : undefined);
    runs = await replayChecks(ctx, { 'open-path': openPath, unlisted });
  }
  return report.finish({ checked: steps.length + runs, unit: 'versions and replays' });
});
