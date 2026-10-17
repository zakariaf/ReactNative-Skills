#!/usr/bin/env node
// check-persistence.mjs: checks an Expo app's local data layer: SQLite only in the data folder through the
// SqlDriver port, WAL + synchronous FULL + foreign keys, a version check before any write, a snapshot
// before migrating, forward-only frozen steps replayed on node:sqlite against frozen fixtures, validated
// repository writes and reads, transactions, protected resets, read-only peeks, the background checkpoint,
// and (mode document/both) the save-document appendix.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-persistence.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, notYetCreated, parseArgs, readWorkspaces, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { checkDocument } from './lib/document-rules.mjs';
import { replayMigrations } from './lib/migration-replay.mjs';
import { knownTables, loadSources } from './lib/persistence-source.mjs';
import { checkDocumentWriters, checkRepoFiles, KEY_VALUE_STORES, keyValueStoreOf, LOCAL_STORAGE_INSTALL, SECOND_ENGINES } from './lib/repo-rules.mjs';
import { checkBackgroundCheckpoint, checkBaselineWired, checkBoundParams, checkFixtures, checkMigrations, checkOpenAtImport, checkOpenPath, checkPeeks, checkRepositories, checkRequiredFiles, checkResets, checkSchemas, checkSqlOutsideRepositories, isStepFile, paths } from './lib/tables-rules.mjs';

const SPEC = {
  name: 'check-persistence',
  summary: "Checks an Expo app's local data layer (src/data by default) against the persistence rules, replays its migrations on node:sqlite against the frozen fixtures, and checks the save-document appendix when contracts/persistence.json says mode document or both.",
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The persistence contract (default: <contractsDir>/persistence.json)' },
    'data-dir': { type: 'string', value: 'dir', help: 'The data folder (default: from resolveLayout, src/data); required when several workspaces have one' },
    'no-replay': { type: 'boolean', help: 'Skip running the migrations on node:sqlite (static rules only)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (every mode):',
    '  contract                contracts/persistence.json is missing or malformed',
    '  missing-file            a required data-layer file is missing',
    '  sqlite-outside-data     expo-sqlite / node:sqlite, or the SqlDriver port (<dataDir>/sql-driver.ts), imported',
    '                          outside the data folder, tests and scripts (the SQLite error log adapter and sqlAllowed',
    '                          may hold the port); expo-sqlite/kv-store, expo-sqlite/localStorage/install or a read of',
    '                          the global localStorage outside a preferences adapter (services/<concern>/*-adapter.ts);',
    '                          outside the data folder, a driver.run/get/all/exec/transaction call, or `.driver` on',
    '                          useAppData(), an opener or an AppData/AppDatabase value (or cast to SqlDriver), in a',
    '                          file that imports the data layer; `.driver` on the app\'s own nouns is left alone',
    '  second-persistence      AsyncStorage, another database engine, zustand persist, or a second key-value store',
    '                          (a file listed in the contract\'s legacyImports may import an older engine once)',
    '  single-validator        zod, yup, superstruct, io-ts, joi, ajv, arktype or typebox imported (valibot is the one)',
    '  sql-outside-data        SQL text outside the data folder: uppercase keywords, any case on one of the app\'s',
    '                          tables, or any statement handed to .run/.get/.all/.exec (contract sqlAllowed lists',
    '                          exceptions)',
    '  sql-bound-params        SQL built from a value in the data folder: a template literal with ${...}, or an SQL',
    '                          literal concatenated with a non-literal wherever it sits; the PRAGMA user_version stamp',
    '                          is the one exception',
    '  sql-outside-repository  a data-folder file other than sqlite-<area>-repository.ts runs statements (.run/.exec,',
    '                          or .get/.all on a driver); allowed: app-database, database-schema, database-snapshots,',
    '                          *-sql-driver, migrations/, document/, peek-*, the reset modules and contract sqlAllowed',
    '  open-at-import          openDeviceData / openDeviceDatabase / openAppDatabase called at module level in src/,',
    '                          its result passed to useState (useState(openOnce()) opens on every render), or an',
    '                          opener (or a same-file function reaching one) called in a component or hook body',
    '  pragmas                 no journal_mode = WAL, synchronous = FULL or foreign_keys = ON, or a table not STRICT',
    '  newer-db-crash          the open path throws, writes before the version check, or has no newer-version outcome',
    '  unversioned-data        the open path does not check, before the pragmas, whether a user_version 0 file holds',
    '                          tables; a db-v0-<variant>.sql the BASELINE would not adopt; BASELINE set but never passed',
    '  migration-snapshot      no VACUUM INTO snapshot right before the migrations run, a failed snapshot that does not',
    '                          stop them, snapshots never pruned, or a snapshot name built from the time',
    '  transaction-write       a step and its version stamp, a multi-statement or per-item-loop write (helpers it',
    '                          calls included), or a reset outside one transaction; or no wal_checkpoint(TRUNCATE)',
    '  migration-chain         a gap in vNNNN-<name>.ts, an unregistered or misordered step, a wrong version or name',
    '  migration-pure          a step imports runtime code or reads time or randomness',
    '  migration-forward-only  a step declares down, stamps user_version, opens a transaction or toggles foreign_keys',
    '  migration-rebuild       a step drops or renames a table without rebuildsTables: true',
    '  fixture-missing         db-vN.sql or its checksum entry is missing for a shipped version, or a BASELINE variant',
    '                          has no db-v0-<variant>.sql',
    '  fixture-frozen          a frozen fixture changed (checksum, or its user_version)',
    '  fixture-untested        the fixtures test does not replay a fixture (FIXTURES, LEGACY_FIXTURES)',
    '  migration-replay        on node:sqlite with foreign keys on: a fresh install fails, an upgrade fails, an upgraded',
    '                          fixture differs from a fresh install, breaks integrity or foreign keys, or loses rows',
    '  peek-writes             a peek-*.ts writes, runs DDL or migrates',
    '  no-background-checkpoint nothing checkpoints on background, or the hook is never called',
    'Rules (mode tables or both): validate-before-write (v.parse/v.safeParse of the input before a write, here or in a',
    '  same-file helper; a parse of what a driver read returned does not count; a .run() whose SQL the checker cannot',
    '  resolve counts as a write; SQL constants imported from another file and same-file aliases are resolved),',
    '  validate-on-read (what .get/.all on the driver returns, whatever its SQL argument, reaches a parse that takes it:',
    '  the call, a variable, loop binding or array-callback parameter derived from it, or a same-file helper parameter',
    '  that does), exec-in-repository (driver.exec in a repository file),',
    '  sql-outside-method (a statement outside every repository method and the helpers they call), schema-strict,',
    '  protected-reset (also SQL built from a value).',
    'Rules (mode document or both): missing-file, schema-strict, schema-version, migration-chain, migration-pure,',
    '  fixture-*, validate-before-write, protected-reset, quarantine-not-delete, write-outside-service.',
    '',
    'NOT APPLICABLE when package.json lists no local persistence package (expo-sqlite, AsyncStorage, MMKV, ...), and',
    'when the app keeps no database: no contract, no data folder, and expo-sqlite not imported or only as',
    'expo-sqlite/kv-store or expo-sqlite/localStorage/install (the repo-wide rules still run first:',
    'sqlite-outside-data, second-persistence, single-validator, sql-outside-data).',
    'Limits (heuristic, by design): a driver is recognised by its receiver name (driver, db, reader, a name typed',
    'SqlDriver or taken from .driver) or by an SQL argument; SQL built at run time is unknown and counts as a write;',
    'rows are followed by name within one file (not through object fields or closures), and the schema a parse uses',
    'is not compared with the table it reads.',
    'SKIP: the root layout named by rootComponent, until it exists (app-startup-and-bootstrap creates it).',
  ].join('\n'),
};

const MODES = ['tables', 'document', 'both'];

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} ${path} is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
}

/** Every dependency name of the root package.json and of each workspace. */
function dependencies(root) {
  const manifests = [readJson(join(root, 'package.json'), 'package.json'), ...readWorkspaces(root).map((entry) => entry.manifest ?? {})];
  return new Set(manifests.flatMap((manifest) => ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => Object.keys(manifest?.[key] ?? {}))));
}

/** The layout whose data folder this run checks (single app, or the one workspace that has one). */
function chooseLayout(root, dataDir) {
  const layout = resolveLayout(root, { dataDir });
  if (dataDir !== undefined || existsSync(join(root, layout.dataDir)) || layout.workspaces.length === 0) return layout;
  const withData = layout.workspaces.filter((entry) => existsSync(join(root, entry.layout.dataDir)));
  if (withData.length > 1) throw new UsageError(`several workspaces have a data folder (${withData.map((entry) => entry.layout.dataDir).join(', ')})`, 'Pass --data-dir <dir> for the app to check (one run per app).');
  return withData.length === 1 ? { ...layout, ...withData[0].layout, workspaces: layout.workspaces } : layout;
}

function readContract(ctx, file) {
  if (!existsSync(join(ctx.root, file))) {
    ctx.add({ file, rule: 'contract', message: 'the persistence contract is missing', fix: 'Copy templates/contracts/persistence.json (and its schema) and fill in the app\'s facts: mode, protected tables, reset modules.' });
    return { mode: 'tables', protectedTables: [], resetModules: [] };
  }
  let contract;
  try {
    contract = JSON.parse(readFileSync(join(ctx.root, file), 'utf8'));
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON: ${error.message}`, 'Fix the JSON syntax of the contract.');
  }
  const bad = (key, message) => ctx.add({ file, rule: 'contract', message: `${key}: ${message}`, fix: 'Follow persistence.schema.json (shipped next to the template).' });
  if (!MODES.includes(contract.mode)) bad('mode', `must be one of ${MODES.join(', ')}`);
  if (typeof contract.databaseFile !== 'string' || !/^[A-Za-z0-9._-]+\.db$/.test(contract.databaseFile)) bad('databaseFile', 'must be a file name ending in .db');
  for (const key of ['protectedTables', 'resetModules', 'sqlAllowed', 'legacyImports']) {
    if (contract[key] !== undefined && !(Array.isArray(contract[key]) && contract[key].every((item) => typeof item === 'string'))) bad(key, 'must be a list of strings');
  }
  if (contract.keyValueStore !== undefined && !KEY_VALUE_STORES.includes(contract.keyValueStore)) bad('keyValueStore', `must be one of ${KEY_VALUE_STORES.join(', ')}`);
  return { ...contract, mode: MODES.includes(contract.mode) ? contract.mode : 'tables' };
}

/** The one key-value store a repo without a contract uses (the only one it imports), else kv-store. */
function detectedKeyValueStore(sources) {
  const used = new Set([...sources.values()].flatMap((src) => src.imports.map((entry) => keyValueStoreOf(entry.spec))).filter((spec) => KEY_VALUE_STORES.includes(spec)));
  return used.size === 1 ? [...used][0] : 'expo-sqlite/kv-store';
}

/** No contract, no data folder, and no file imports expo-sqlite other than its key-value store: preferences only. */
function isKeyValueOnly(ctx, contractFile) {
  if (ctx.exists(contractFile) || ctx.exists(ctx.dataDir)) return false;
  const isDatabase = (spec) => /^(expo-sqlite(\/.*)?|node:sqlite)$/.test(spec) && spec !== 'expo-sqlite/kv-store' && spec !== LOCAL_STORAGE_INSTALL;
  return ![...ctx.sources.values()].some((src) => !src.rel.startsWith(`${ctx.layout.scriptsDir}/`) && src.imports.some((entry) => isDatabase(entry.spec)));
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root (or pass it as the first argument).');
  const report = createReporter({ name: 'check-persistence', json: options.json });
  const deps = dependencies(root);
  const packages = ['expo-sqlite', ...SECOND_ENGINES.keys(), 'react-native-mmkv'];
  if (!packages.some((name) => deps.has(name))) return report.notApplicable('package.json lists no local persistence package (expo-sqlite, AsyncStorage, MMKV, ...)');
  const layout = chooseLayout(root, options['data-dir']);
  const files = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] });
  const ctx = {
    root,
    layout,
    dataDir: layout.dataDir,
    sources: loadSources(root, files),
    contract: {},
    exists: (rel) => existsSync(join(root, rel)),
    add: ({ file, line, rule, message, fix }) => report.problem({ file, line, rule, message, fix }),
    skip: ({ file, rule, message }) => report.skip({ file, rule, message }),
    note: (text) => report.note(text),
    notYetCreated: (file, owner) => notYetCreated(root, { file, owner }),
  };
  const contractFile = options.contract ?? `${layout.contractsDir}/persistence.json`;
  ctx.keyValueStore = detectedKeyValueStore(ctx.sources);
  ctx.tables = knownTables(ctx.sources, (rel) => isStepFile(ctx, rel));
  if (isKeyValueOnly(ctx, contractFile)) {
    checkRepoFiles(ctx);
    if (report.count > 0) return report.finish({ checked: files.length, unit: 'source files' });
    return report.notApplicable(`no app database: no ${contractFile}, no ${layout.dataDir}/, and expo-sqlite is not imported, or only as expo-sqlite/kv-store or expo-sqlite/localStorage/install (preferences); the repo-wide rules passed`);
  }
  ctx.contract = readContract(ctx, contractFile);
  checkRepoFiles(ctx);
  checkRequiredFiles(ctx);
  checkOpenPath(ctx);
  const latest = checkMigrations(ctx);
  const fixtures = checkFixtures(ctx, latest);
  checkPeeks(ctx);
  checkBaselineWired(ctx);
  checkBoundParams(ctx);
  checkSqlOutsideRepositories(ctx);
  checkOpenAtImport(ctx);
  checkBackgroundCheckpoint(ctx);
  const { mode } = ctx.contract;
  if (mode !== 'document') {
    checkRepositories(ctx);
    checkResets(ctx);
  }
  checkSchemas(ctx, { document: mode !== 'tables' });
  if (mode !== 'tables') {
    checkDocument(ctx);
    checkDocumentWriters(ctx);
  }
  const p = paths(ctx);
  if (!options['no-replay'] && ctx.exists(p.runner) && ctx.exists(p.list)) await replayMigrations(ctx, { runner: p.runner, list: p.list, fixtures });
  return report.finish({ checked: files.length, unit: 'source files' });
});
