// sqlite-drill.mjs: runs the app's own migrations and open path on node:sqlite (a helper, not an entry
// point): every from-to path between the frozen fixtures, and the forced-failure restore drill on real
// files in a temporary folder (A: a step fails halfway, B: a committed wrong step is restored, C: the
// previous build opens the upgraded file). restore-snapshot uses its node:sqlite loader.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import { makeTempDir, removeTempDir, sha256 } from '../check-lib.mjs';
import { enableAppImports, errorText } from './app-modules.mjs';

const NESTED_TRANSACTION_MESSAGE = 'SqlDriver.transaction cannot nest: run every statement of a change inside one outer transaction';

/** node:sqlite's DatabaseSync, or null on a Node without it. */
export async function loadDatabaseSync() {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch {
    return null;
  }
}

/**
 * The SqlDriver contract over node:sqlite, as the app's test driver keeps it: foreign keys off until
 * the app's pragma (as the SQLite expo-sqlite bundles), a nested transaction() refused.
 */
export function nodeDriver(DatabaseSync, path, { readOnly = false } = {}) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false, readOnly });
  let isOpen = true;
  return {
    path,
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    get: (sql, params) => {
      const row = db.prepare(sql).get(...params);
      return row === undefined ? null : { ...row };
    },
    all: (sql, params) => db.prepare(sql).all(...params).map((row) => ({ ...row })),
    transaction: (work) => {
      if (db.isTransaction) throw new Error(NESTED_TRANSACTION_MESSAGE);
      db.exec('BEGIN');
      try {
        work();
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => {
      if (isOpen) db.close();
      isOpen = false;
    },
  };
}

const quoted = (name) => `"${String(name).replaceAll('"', '""')}"`;

export function userTables(driver) {
  return driver.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", []).map((row) => String(row.name));
}

/** The schema as the app compares it: sqlite_master without SQLite's own objects. */
export function schemaOf(driver) {
  return driver.all("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name", []);
}

/** user_version, schema and every row of every table (ordered by all columns): one comparable value. */
export function contentOf(driver) {
  const rows = {};
  for (const table of userTables(driver)) {
    const columns = driver.all('SELECT name FROM pragma_table_info(?)', [table]).map((column) => quoted(column.name));
    rows[table] = driver.all(`SELECT * FROM ${quoted(table)} ORDER BY ${columns.join(', ')}`, []);
  }
  return JSON.stringify({ version: driver.get('PRAGMA user_version', [])?.user_version, schema: schemaOf(driver), rows });
}

export function countsOf(driver) {
  return new Map(userTables(driver).map((table) => [table, Number(driver.get(`SELECT COUNT(*) AS n FROM ${quoted(table)}`, []).n)]));
}

/** "tasks: 0 of 4" for every table that exists before and after and holds fewer rows after. */
export function lostRows(before, after) {
  return [...before].filter(([table, count]) => after.has(table) && after.get(table) < count).map(([table, count]) => `${table}: ${after.get(table)} of ${count}`);
}

/** quick_check, integrity_check and foreign_key_check of an open database. */
export function healthOf(driver, { quick = false } = {}) {
  const pragma = quick ? 'quick_check' : 'integrity_check';
  const integrity = driver.all(`PRAGMA ${pragma}`, []).map((row) => row[pragma]);
  return { ok: integrity.length === 1 && integrity[0] === 'ok', integrity: integrity[0], orphans: driver.all('PRAGMA foreign_key_check', []).length };
}

function firstDifference(expected, actual) {
  const key = (row) => `${row.type} ${row.name}`;
  const byKey = new Map(actual.map((row) => [key(row), row]));
  for (const row of expected) {
    const other = byKey.get(key(row));
    if (other === undefined) return `${key(row)} is missing`;
    if (other.sql !== row.sql) return `${key(row)} differs (expected ${JSON.stringify(String(row.sql).replace(/\s+/g, ' ').slice(0, 90))}, got ${JSON.stringify(String(other.sql).replace(/\s+/g, ' ').slice(0, 90))})`;
  }
  const extra = actual.find((row) => !expected.some((each) => key(each) === key(row)));
  return extra === undefined ? null : `${key(extra)} is extra`;
}

/** Loads the app's runner, list and (optionally) open path through Node type stripping. */
export async function loadApp(root, paths, { openPath } = {}) {
  const modules = enableAppImports(root);
  const { migrateDatabase } = await modules.load(paths.runner);
  const { MIGRATIONS } = await modules.load(paths.list);
  if (typeof migrateDatabase !== 'function' || !Array.isArray(MIGRATIONS)) throw new Error('migrateDatabase (migration-runner.ts) or MIGRATIONS (migrations.ts) is not exported');
  const app = { migrateDatabase, migrations: MIGRATIONS };
  if (openPath !== undefined) {
    const open = await modules.load(openPath);
    if (typeof open.openAppDatabase !== 'function') throw new Error(`${openPath} does not export openAppDatabase`);
    app.openAppDatabase = open.openAppDatabase;
  }
  return app;
}

const fixtureText = (root, rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** The first line of the error a frozen fixture raises when it is loaded into an empty database, or null. */
export function fixtureLoadError(DatabaseSync, root, rel) {
  const driver = nodeDriver(DatabaseSync, ':memory:');
  try {
    driver.exec(fixtureText(root, rel));
    return null;
  } catch (error) {
    return errorText(error).split('\n')[0].replace(/^Error: /, '');
  } finally {
    driver.close();
  }
}

/**
 * Every [from, to] with from = 0 (an empty file) or a version with a frozen fixture and to every
 * later version: the upgrade must succeed, give the target fixture's schema (a fresh install's when
 * the target has no fixture), keep every row, and pass integrity and foreign key checks.
 */
export function everyPath(ctx, { DatabaseSync, app, fixtures }) {
  const latest = app.migrations.length;
  const open = (version) => {
    const driver = nodeDriver(DatabaseSync, ':memory:');
    if (version > 0) driver.exec(fixtureText(ctx.root, fixtures.get(version)));
    driver.exec('PRAGMA foreign_keys = ON');
    return driver;
  };
  const targetSchema = new Map();
  for (let to = 1; to <= latest; to += 1) {
    const driver = fixtures.has(to) ? open(to) : open(0);
    if (!fixtures.has(to)) app.migrateDatabase(driver, app.migrations.slice(0, to));
    targetSchema.set(to, schemaOf(driver));
    driver.close();
  }
  let runs = 0;
  for (const from of [0, ...[...fixtures.keys()].filter((version) => version < latest).sort((a, b) => a - b)]) {
    for (let to = from + 1; to <= latest; to += 1) {
      runs += 1;
      checkPath(ctx, { open, app, fixtures, targetSchema }, from, to);
    }
  }
  return runs;
}

function checkPath(ctx, { open, app, fixtures, targetSchema }, from, to) {
  const label = from === 0 ? `an empty file to v${to}` : `db-v${from} to v${to}`;
  const file = from === 0 ? ctx.paths.list : fixtures.get(from);
  const add = (message, fix) => ctx.add({ file, line: 1, rule: 'every-path', message, fix });
  const driver = open(from);
  try {
    const before = countsOf(driver);
    const result = app.migrateDatabase(driver, app.migrations.slice(0, to));
    if (result.kind !== 'migrated') {
      add(`upgrading ${label} ${result.kind === 'failed' ? `fails at version ${result.at}: ${result.reason}` : `ends as ${result.kind}`}`, 'A step must work on every database an older version wrote, whatever version it started from: fix the pending step (a shipped one never changes; fix forward).');
      return;
    }
    const target = fixtures.has(to) ? `the frozen db-v${to}.sql` : 'a fresh install';
    const difference = firstDifference(targetSchema.get(to), schemaOf(driver));
    if (difference !== null) add(`upgrading ${label} does not give the schema of ${target}: ${difference}`, `The pending step changed after db-v${to}.sql was frozen (re-freeze the fixture, it has not shipped), or a shipped step was edited (restore it from git and change the schema in a new version).`);
    const health = healthOf(driver);
    if (!health.ok || health.orphans > 0) add(`upgrading ${label} leaves a broken database (integrity: ${health.integrity}, ${health.orphans} orphan row(s))`, 'Fix the step so every row still satisfies its constraints and foreign keys.');
    const lost = lostRows(before, countsOf(driver));
    if (lost.length > 0) add(`upgrading ${label} loses rows (${lost.join(', ')})`, 'Every saved row must survive the upgrade: copy every row in a rebuild (plain INSERT ... SELECT, never OR IGNORE) and move rows a step must drop to an archive table.');
  } finally {
    driver.close();
  }
}

/** Moves the database files aside and copies the snapshot over the database name (the runbook's restore). */
export function restoreFiles(databasePath, snapshotPath, keepDir) {
  mkdirSync(keepDir, { recursive: true });
  const kept = ['', '-wal', '-shm'].map((suffix) => `${databasePath}${suffix}`).filter((path) => existsSync(path));
  for (const path of kept) renameSync(path, join(keepDir, basename(path)));
  copyFileSync(snapshotPath, databasePath);
  return kept.map((path) => basename(path));
}

/**
 * The forced-failure drill through the app's own open path on real files:
 * A: the newest step (or a stand-in after v1) throws after its SQL ran: the file keeps every byte
 *    of content, and its snapshot <file>.v<from>.bak holds the same content;
 * B: a step that commits a wrong change (every row deleted) is undone by restoring the snapshot,
 *    and the restored file opens as ready.
 */
export function restoreDrill(ctx, { DatabaseSync, app, fixtures, openPath }) {
  const latest = app.migrations.length;
  const dir = makeTempDir('run-migration-drill-');
  const opened = [];
  const fileName = 'app.db';
  const file = join(dir, fileName);
  const deps = (migrations) => ({
    openDriver: (name) => {
      const driver = nodeDriver(DatabaseSync, name === ':memory:' ? name : join(dir, name));
      opened.push(driver);
      return driver;
    },
    files: { list: (folder) => readdirNames(folder), remove: (path) => removeFile(path) },
    fileName,
    migrations,
    errorLog: { record: () => undefined },
  });
  const closeAll = () => opened.splice(0).forEach((driver) => driver.close());
  const add = (message, fix) => ctx.add({ file: openPath, line: 1, rule: 'restore-drill', message, fix });
  const writeFixture = (version) => {
    const driver = nodeDriver(DatabaseSync, file);
    driver.exec(fixtureText(ctx.root, fixtures.get(version)));
    driver.close();
  };
  const read = (path) => {
    const driver = nodeDriver(DatabaseSync, path);
    try {
      return contentOf(driver);
    } finally {
      driver.close();
    }
  };
  const parts = { app, latest, deps, closeAll, add, writeFixture, read, file, dir, fixtures };
  try {
    drillHalfway(parts);
    clearFolder(dir);
    drillCommittedWrong(parts);
    clearFolder(dir);
    drillPreviousBuild(parts);
  } catch (error) {
    add(`the drill crashed: ${errorText(error).split('\n')[0]}`, 'The open path must never throw (persistence-and-migrations rule 3); run the drill test (test/sqlite/migration-restore-drill.test.ts) to see where.');
  } finally {
    closeAll();
    removeTempDir(dir);
  }
  return 3;
}

function drillHalfway({ app, latest, deps, closeAll, add, writeFixture, read, file, fixtures }) {
  const from = Math.max(1, latest - 1);
  if (!fixtures.has(from)) return;
  const fail = (step) => ({ ...step, up: (driver) => { step.up(driver); throw new Error('forced failure after the step ran'); } });
  const probe = { version: latest + 1, name: 'drill-probe', up: (driver) => driver.exec('CREATE TABLE drill_probe (id INTEGER PRIMARY KEY) STRICT') };
  const steps = latest >= 2 ? [...app.migrations.slice(0, -1), fail(app.migrations[latest - 1])] : [...app.migrations, fail(probe)];
  writeFixture(from);
  const before = read(file);
  const database = app.openAppDatabase(deps(steps));
  closeAll();
  if (database?.outcome?.kind !== 'migration-failed') {
    add(`a step that fails halfway on db-v${from} ends as "${database?.outcome?.kind}", expected "migration-failed"`, 'Keep the template open path: a failing step becomes the migration-failed outcome and an in-memory session.');
  }
  if (read(file) !== before) add(`a step that failed halfway on db-v${from} changed the file`, 'Each step and its version stamp run in one transaction (migration-runner.ts applyStep): restore the shared runner.');
  const snapshot = `${file}.v${from}.bak`;
  if (!existsSync(snapshot)) add(`no snapshot ${basename(snapshot)} was taken before migrating db-v${from}`, "The open path copies the file with VACUUM INTO '<file>.v<from>.bak' before the first pending step, and migrates nothing without it.");
  else if (read(snapshot) !== before) add(`the snapshot taken before migrating db-v${from} differs from the database it copies`, 'Take the snapshot before any step runs (VACUUM INTO right before migrateDatabase), never after.');
}

function drillCommittedWrong({ app, latest, deps, closeAll, add, writeFixture, read, file, dir, fixtures }) {
  // The newest frozen database (the pending one when it is frozen already).
  const from = Math.max(...fixtures.keys());
  writeFixture(from);
  const before = read(file);
  const tables = Object.keys(JSON.parse(before).rows);
  const wipe = { version: latest + 1, name: 'drill-wipe-every-row', rebuildsTables: true, up: (driver) => tables.forEach((table) => driver.run(`DELETE FROM ${quoted(table)}`, [])) };
  const database = app.openAppDatabase(deps([...app.migrations, wipe]));
  closeAll();
  const snapshot = `${file}.v${from}.bak`;
  if (database?.outcome?.kind !== 'migrated') {
    add(`a committed step on db-v${from} ends as "${database?.outcome?.kind}", expected "migrated"`, 'Keep the template open path (openAppDatabase) so the drill can run.');
    return;
  }
  if (!existsSync(snapshot)) {
    add(`no snapshot ${basename(snapshot)} exists after a committed upgrade of db-v${from}: a wrong step could never be undone`, "Snapshot with VACUUM INTO '<file>.v<from>.bak' before migrating, and prune only older snapshots after a success.");
    return;
  }
  restoreFiles(file, snapshot, join(dir, 'kept'));
  if (read(file) !== before) add(`restoring ${basename(snapshot)} does not give back db-v${from} as it was`, 'The snapshot must be a full copy of the database taken before the first step (VACUUM INTO), restored with the app stopped and -wal/-shm removed.');
  const again = app.openAppDatabase(deps(app.migrations));
  closeAll();
  const expected = from === latest ? 'ready' : 'migrated';
  if (again?.outcome?.kind !== expected) add(`the restored database opens as "${again?.outcome?.kind}", expected "${expected}"`, 'A restored snapshot is at its from-version: it opens without migrating, or migrates again through the real steps.');
}

/**
 * C: the previous build (every step but the newest) opens a file the new build upgraded, as after a
 * rollback to older code: it must see a newer file and leave every byte alone (the file's sha256 is
 * the same and no -wal is left beside it). A content comparison alone misses a write that changes no
 * row: `PRAGMA optimize` or ANALYZE fills sqlite_stat1, VACUUM rewrites every page.
 */
function drillPreviousBuild({ app, latest, deps, closeAll, add, writeFixture, read, file, fixtures }) {
  if (!fixtures.has(latest)) return;
  writeFixture(latest);
  const bytes = sha256(readFileSync(file));
  const before = read(file);
  const database = app.openAppDatabase(deps(app.migrations.slice(0, latest - 1)));
  closeAll();
  if (database?.outcome?.kind !== 'newer-version') {
    add(`the previous build (${latest - 1} steps) opens db-v${latest} as "${database?.outcome?.kind}", expected "newer-version"`, 'The open path reads user_version first and leaves a newer file untouched (persistence-and-migrations rule 3): a rollback must never write it.');
  }
  const fix = 'Read the version first and return before any pragma, optimize, VACUUM or write when the file is newer (APP_DB_PRAGMAS after readUserVersion).';
  if (read(file) !== before) add(`the previous build changed db-v${latest} when it opened it`, fix);
  else if (sha256(readFileSync(file)) !== bytes || existsSync(`${file}-wal`)) {
    add(`the previous build rewrote db-v${latest}'s bytes when it opened it (the rows are the same): a statement ran on a newer file`, fix);
  }
}

function readdirNames(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function removeFile(path) {
  rmSync(path);
}

function clearFolder(dir) {
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
}
