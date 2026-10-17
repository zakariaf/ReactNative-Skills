#!/usr/bin/env node
// inspect-database.mjs: says whether an app database is healthy, from a COPY (the app's files are never
// opened in place): opens as SQLite, user_version as expected, WAL, integrity_check, foreign_key_check,
// and with --document the slots (both present, checksums, JSON, versions, app id, empty quarantine).
// Also writes a deterministic .sql dump (--dump) to freeze a migration fixture. The kill test's verdict.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/inspect-database.mjs <app.db|dump.sql> [options]

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { dumpDatabase, inspectDatabase, loadDatabaseSync, stageDatabase, textChecksum } from './lib/database-health.mjs';
import { emulatorDatabase, simulatorDatabase } from './lib/device-copy.mjs';

const SPEC = {
  name: 'inspect-database',
  summary: "Checks an app database (a file, a .sql dump, or the installed app's file on a named iOS simulator or Android emulator) on a copy: readable, user_version, WAL, integrity, foreign keys, and with --document the save-document slots. --dump writes a reviewable .sql dump of the copy.",
  usage: '[<app.db|dump.sql>] [--udid <id> --bundle-id <id> | --serial <serial> --package <id>] [options]',
  options: {
    udid: { type: 'string', value: 'id', help: "iOS simulator UDID: read the installed app's Documents/SQLite/<db-name>" },
    'bundle-id': { type: 'string', value: 'id', help: 'The app bundle id on that simulator' },
    serial: { type: 'string', value: 'serial', help: "Android emulator serial (adb devices): read the app's files/SQLite/<db-name>" },
    package: { type: 'string', value: 'id', help: 'The app package name on that emulator' },
    'android-root': { type: 'boolean', help: 'Read with root access (adb -s <serial> root; an emulator image without Google Play) instead of run-as' },
    'db-name': { type: 'string', default: 'app.db', value: 'file', help: 'The database file name (contracts/persistence.json databaseFile)' },
    'expect-version': { type: 'string', value: 'n', help: 'The user_version this build writes (LATEST_DB_VERSION)' },
    'max-version': { type: 'string', value: 'n', help: 'The highest user_version this build knows (a higher one is reported)' },
    document: { type: 'boolean', help: 'Also check the save-document slots (document_slots, document_quarantine)' },
    'app-id': { type: 'string', value: 'id', help: 'The appId every stored document must carry (with --document)' },
    'max-document-version': { type: 'string', value: 'n', help: 'The highest document schemaVersion this build knows' },
    'allow-quarantine': { type: 'boolean', help: 'Do not fail on document_quarantine rows (after a planned damage test)' },
    deep: { type: 'boolean', help: "Also decode each slot with the app's own decodeSlot (needs --repo, --document, --app-id)" },
    repo: { type: 'string', value: 'dir', help: 'App repo root for --deep' },
    dump: { type: 'string', value: 'file', help: 'Write a deterministic .sql dump of the copy to this file (to freeze db-vN.sql)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: open, user-version, newer-version, journal-mode, integrity, foreign-keys; with --document:',
    'no-document-table, slot-missing, checksum, json, schema-version, newer-version, app-id, quarantine, decode.',
    '',
    'Examples:',
    '  node inspect-database.mjs ./app.db --expect-version 2',
    '  node inspect-database.mjs --udid "$UDID" --bundle-id com.example.tasks --expect-version 2',
    '  node inspect-database.mjs --serial emulator-5554 --package com.example.tasks --expect-version 2',
    '  node inspect-database.mjs ./copy-of-app.db --dump src/data/migrations/fixtures/db-v2.sql',
  ].join('\n'),
};

const number = (value, name) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`--${name} must be a whole number, got ${value}`);
  return parsed;
};

function sourceOf(options, positionals) {
  const dbName = options['db-name'];
  if (options.udid !== undefined || options['bundle-id'] !== undefined) {
    if (options.udid === undefined || options['bundle-id'] === undefined) fail('--udid and --bundle-id go together');
    return simulatorDatabase(options.udid, options['bundle-id'], dbName);
  }
  if (options.serial !== undefined || options.package !== undefined) {
    if (options.serial === undefined || options.package === undefined) fail('--serial and --package go together');
    return emulatorDatabase(options.serial, options.package, dbName, { root: options['android-root'] });
  }
  if (positionals[0] !== undefined) return requireFile(positionals[0], 'database');
  return fail('nothing to inspect: pass a database file (or .sql dump), --udid with --bundle-id, or --serial with --package', 'Example: node inspect-database.mjs ./app.db --expect-version 1');
}

async function decoderOf(options) {
  if (!options.deep) return undefined;
  if (options.repo === undefined || !options.document || options['app-id'] === undefined) fail('--deep needs --repo <app repo>, --document and --app-id <id>');
  const repo = requireDir(options.repo, 'app repo root');
  const codec = await enableAppImports(repo).load(`${resolveLayout(repo).dataDir}/document/document-codec.ts`);
  return (record) => codec.decodeSlot(record, options['app-id']);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const DatabaseSync = await loadDatabaseSync();
  if (DatabaseSync === null) fail('node:sqlite is not available in this Node', 'Use Node 22.18 or newer.');
  const source = sourceOf(options, positionals);
  const decode = await decoderOf(options);
  const report = createReporter({ name: 'inspect-database', json: options.json });
  const staged = stageDatabase(DatabaseSync, source, options['db-name']);
  try {
    const document = options.document ? { appId: options['app-id'], maxVersion: number(options['max-document-version'], 'max-document-version'), allowQuarantine: options['allow-quarantine'], decode } : undefined;
    const result = inspectDatabase(DatabaseSync, staged.path, { expectVersion: number(options['expect-version'], 'expect-version'), maxVersion: number(options['max-version'], 'max-version'), document });
    for (const line of result.lines) console.log(line);
    for (const problem of result.problems) report.problem({ file: source, ...problem });
    if (options.dump !== undefined && !result.problems.some((problem) => problem.rule === 'open')) writeDump(DatabaseSync, staged.path, options.dump);
  } finally {
    staged.cleanup();
  }
  return report.finish({ checked: 1, unit: 'databases' });
});

function writeDump(DatabaseSync, path, out) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const header = `${out}: a database written at user_version ${version}. Frozen once committed: never edit it; record its checksum in fixture-checksums.ts.`;
    const text = dumpDatabase(db, { header });
    writeFileSync(resolve(out), text);
    console.log(`dump: ${out} (checksum ${textChecksum(text)})`);
  } finally {
    db.close();
  }
}
