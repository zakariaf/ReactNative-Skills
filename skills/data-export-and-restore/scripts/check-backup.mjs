#!/usr/bin/env node
// check-backup.mjs: checks an Expo app's data export and restore: the versioned, checksummed backup envelope,
// the validation ladder, the all-or-nothing replace after a safety copy, table coverage, upgrades and frozen
// fixtures, the round-trip test, the guarded CSV, atomic file writes, and share/pick behind ports from a press.
// Usage: node check-backup.mjs [repo-root] [--backup-dir <dir>] [--json]
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, resolveLayout, run, walkRepo } from './check-lib.mjs';
import {
  checkCoverage,
  checkEnvelopeChecks,
  checkEnvelopeModule,
  checkFixtures,
  checkProtectedSql,
  checkReaderOrder,
  PAYLOAD_PARSE,
  checkRestoreTransaction,
  checkTypedFailures,
  checkUpgradeChain,
  loadSource,
  migratedTables,
  migrationSteps,
  readProtectedTables,
} from './lib/backup-rules.mjs';
import {
  checkAtomicWrite,
  checkCanonicalValues,
  checkCsvModule,
  checkCsvUse,
  checkSafetyCopy,
  checkSdkImports,
  checkUserActionOnly,
  csvEncoderUsers,
  isCsvModule,
  isRoundTripTest,
} from './lib/repo-rules.mjs';
import { isTestFile, resolveSpecifier } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-backup',
  summary: 'Checks data export and restore: envelope, validation ladder, all-or-nothing replace, coverage, upgrades, fixtures, round trip, CSV, atomic writes, share and pick behind ports.',
  usage: '[repo-root] [options]',
  options: {
    'backup-dir': { type: 'string', value: 'dir', help: 'The backup module folder (default: rn-skills.config.json "backupDir", else <dataDir>/backup)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (backup folder): envelope-header, schema-version, checksum-first, newer-refused, typed-failures,',
    '  restore-transaction, restore-protected, backup-coverage, upgrade-chain, backup-fixture, round-trip-test,',
    '  safety-copy-first (checksum-first and safety-copy-first also run on runtime files that import the folder)',
    'Rules (whole src/): sdk-behind-port, user-action-only, csv-guard, csv-hand-rolled, canonical-values, atomic-write',
    'NOT APPLICABLE when the app has no backup folder and no source imports expo-sharing or expo-document-picker',
    'or writes CSV. rn-skills.config.json key: "backupDir".',
  ].join('\n'),
};

/** The backup module files, by role: found by what they define, so a renamed file is still checked. */
function backupRoles(sources) {
  const find = (test) => sources.find((src) => test(src)) ?? null;
  return {
    envelope: find((src) => /\bfunction\s+encodeBackup\b/.test(src.code)),
    schema: find((src) => /\bBACKUP_PAYLOAD\s*(?::[^=]+)?=/.test(src.code)),
    upgrades: sources.filter((src) => /\bBACKUP_UPGRADES\b|\bBackupUpgrade\b/.test(src.code) && /\bup\s*:/.test(src.code)),
    /** The file that defines the step list: where a missing step goes (not the step type's file). */
    upgradeList: find((src) => /\bBACKUP_UPGRADES\s*(?::[^=]+)?=/.test(src.code)),
    repositories: sources.filter((src) => /\/sqlite-[a-z0-9-]+-repository\.ts$/.test(src.rel)),
    readers: sources.filter((src) => PAYLOAD_PARSE.test(src.code) && !/\/sqlite-[a-z0-9-]+-repository\.ts$/.test(src.rel)),
  };
}

/**
 * Runtime files outside the backup folder that import from it (a feature, a store): a restore written
 * there must still run the ladder first and write the safety copy before it replaces the tables.
 */
function checkBackupImporters(ctx, { root, layout, backupDir, runtime, checkerName }) {
  const resolve = (from, spec) => resolveSpecifier(from, spec, { root, aliases: layout.aliases });
  const importers = runtime.filter((src) => !src.rel.startsWith(`${backupDir}/`) && src.imports.some((entry) => !entry.typeOnly && (resolve(src.rel, entry.spec) ?? '').startsWith(`${backupDir}/`)));
  for (const src of importers) {
    checkReaderOrder(ctx, src, checkerName);
    checkSafetyCopy(ctx, src);
  }
}

function checkBackupFolder(ctx, { root, layout, backupDir, sources, testSources }) {
  const roles = backupRoles(sources);
  const missing = (rule, file, what) => ctx.add({ file, rule, message: `${what} is missing`, fix: `Copy it from the skill's templates/${file} and adapt it to the app's tables.` });
  let checkerName = null;
  if (roles.envelope === null) missing('envelope-header', `${backupDir}/backup-envelope.ts`, 'the backup envelope (encodeBackup, checkEnvelope)');
  else {
    checkEnvelopeModule(ctx, roles.envelope);
    checkerName = checkEnvelopeChecks(ctx, roles.envelope);
  }
  for (const reader of roles.readers) checkReaderOrder(ctx, reader, checkerName);
  checkTypedFailures(ctx, sources);
  const protectedTables = readProtectedTables(root, layout.contractsDir) ?? ['entitlements', 'error_log'];
  checkProtectedSql(ctx, sources, protectedTables);
  if (roles.repositories.length === 0) missing('restore-transaction', `${backupDir}/sqlite-backup-repository.ts`, 'the SQLite backup repository (readAll, replaceAll)');
  for (const repository of roles.repositories) checkRestoreTransaction(ctx, repository);
  for (const src of sources.filter((each) => !roles.repositories.includes(each))) checkSafetyCopy(ctx, src);

  const migrationsDir = `${layout.dataDir}/migrations`;
  const steps = migrationSteps(root, migrationsDir);
  const skipReason = steps.length === 0 ? notYetCreated(root, { file: migrationsDir, owner: 'persistence-and-migrations' }) ?? 'no vNNNN-*.ts step yet (persistence-and-migrations creates them)' : null;
  if (roles.schema === null) missing('backup-coverage', `${backupDir}/backup-schema.ts`, 'the backup payload schema (BACKUP_PAYLOAD, BACKUP_EXCLUDED_TABLES)');
  else checkCoverage(ctx, roles.schema, { tables: skipReason === null ? migratedTables(root, steps) : null, protectedTables, migrationsDir });

  const roundTrip = testSources.find(isRoundTripTest) ?? null;
  if (roundTrip === null) {
    ctx.add({ file: `${layout.testDir}/sqlite/backup-round-trip.test.ts`, rule: 'round-trip-test', message: 'no round-trip test: export, restore into an empty database, export again, compare the bytes', fix: 'Copy templates/test/sqlite/backup-round-trip.test.ts (real SQL on node:sqlite through the SQLite backup repository, the frozen fixtures, the upgrade parity).' });
  }
  if (skipReason !== null) {
    ctx.skip({ file: migrationsDir, rule: 'upgrade-chain', message: skipReason });
    ctx.skip({ file: migrationsDir, rule: 'backup-fixture', message: skipReason });
    return checkerName;
  }
  const envelopeCode = roles.envelope?.code ?? '';
  const first = Number(/\bFIRST_BACKUP_SCHEMA_VERSION\s*=\s*(\d+)/.exec(envelopeCode)?.[1] ?? 1);
  const latest = steps.at(-1).version;
  const upgradesRel = (roles.upgradeList ?? roles.upgrades[0])?.rel ?? `${backupDir}/backup-upgrades.ts`;
  checkUpgradeChain(ctx, roles.upgrades, { first, latest, upgradesRel });
  const format = /\bBACKUP_FORMAT\s*=\s*(['"])([^'"]+)\1/.exec(roles.envelope?.raw ?? '')?.[2] ?? null;
  checkFixtures(ctx, { root, fixturesDir: `${backupDir}/fixtures`, first, latest, roundTrip, format });
  return checkerName;
}

function checkWholeSource(ctx, sources, { root, layout }) {
  const csvModule = sources.find(isCsvModule) ?? null;
  if (csvModule !== null) {
    checkCsvModule(ctx, csvModule);
    checkCanonicalValues(ctx, csvModule);
  }
  const resolve = (from, spec) => resolveSpecifier(from, spec, { root, aliases: layout.aliases });
  const csv = { csvModuleRel: csvModule?.rel ?? null, users: csvEncoderUsers(sources, csvModule?.rel ?? null, resolve) };
  for (const src of sources) {
    checkSdkImports(ctx, src);
    checkUserActionOnly(ctx, src);
    checkCsvUse(ctx, src, csv);
    checkAtomicWrite(ctx, src);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: no package.json in ${root}`, 'Run it from the app root, or pass the app root as the first argument.');
  const layout = resolveLayout(root);
  const backupDir = options['backup-dir'] ?? layout.config.backupDir ?? `${layout.dataDir}/backup`;
  if (!existsSync(join(layout.root, layout.srcDir))) fail(`nothing to check: no ${layout.srcDir}/ in ${root}`, 'Point the script at the app root (the folder that holds src/).');
  const report = createReporter({ name: 'check-backup', json: options.json });
  const ctx = { layout, add: (entry) => report.problem(entry), skip: (entry) => report.skip(entry) };

  const files = walkRepo(layout.root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] });
  const runtime = files.filter((rel) => rel.startsWith(`${layout.srcDir}/`) && !isTestFile(rel)).map((rel) => loadSource(layout.root, rel));
  const testSources = files.filter((rel) => isTestFile(rel)).map((rel) => loadSource(layout.root, rel));
  const backupSources = runtime.filter((src) => src.rel.startsWith(`${backupDir}/`));
  const hasBackup = existsSync(join(layout.root, backupDir));
  const movesFiles = runtime.some((src) => src.imports.some((entry) => /^expo-(sharing|document-picker)(\/|$)/.test(entry.spec)) || src.strings.some((entry) => entry.value === 'text/csv'));
  if (!hasBackup && !movesFiles) {
    return report.notApplicable(`no ${backupDir}/, and no source file imports expo-sharing or expo-document-picker or writes text/csv`);
  }
  if (hasBackup) {
    const checkerName = checkBackupFolder(ctx, { root: layout.root, layout, backupDir, sources: backupSources, testSources });
    for (const src of backupSources) checkCanonicalValues(ctx, src);
    checkBackupImporters(ctx, { root: layout.root, layout, backupDir, runtime, checkerName });
  } else {
    report.note(`note: no ${backupDir}/: the backup rules did not run (the app exports or shares files without a backup)`);
  }
  checkWholeSource(ctx, runtime, { root: layout.root, layout });
  return report.finish({ checked: runtime.length, unit: 'source files' });
});
