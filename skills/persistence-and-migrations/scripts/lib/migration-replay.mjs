// migration-replay.mjs: runs the app's own migrations on node:sqlite (a helper, not an entry point):
// a fresh install, then every frozen fixture upgraded, compared with the fresh schema. This is what
// proves a shipped step was never edited: the fixture keeps the old schema, the edited step does not.

import { enableAppImports, errorText } from './app-modules.mjs';
import { loadDatabaseSync, schemaOf } from './database-health.mjs';

const NESTED_TRANSACTION_MESSAGE = 'SqlDriver.transaction cannot nest: run every statement of a change inside one outer transaction';

/**
 * The SqlDriver contract over a node:sqlite connection, exactly as test/sqlite/node-sqlite-sql-driver.ts
 * and the device driver keep it: a nested transaction() throws before running anything, and a
 * ROLLBACK runs only while a transaction is still open (a failed COMMIT may already have ended it).
 */
function driverOf(db, path) {
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
    close: () => db.close(),
  };
}

/** "fresh ...x... / upgraded ...y..." around the first character where two statements differ. */
function whereTextsDiffer(fresh, upgraded) {
  const a = fresh.replace(/\s+/g, ' ');
  const b = upgraded.replace(/\s+/g, ' ');
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  const near = (text) => JSON.stringify(text.slice(Math.max(0, at - 25), at + 35));
  return `fresh install has ${near(a)}, the upgraded fixture has ${near(b)}`;
}

function firstDifference(fresh, upgraded) {
  const key = (row) => `${row.type} ${row.name}`;
  const upgradedByKey = new Map(upgraded.map((row) => [key(row), row]));
  for (const row of fresh) {
    const other = upgradedByKey.get(key(row));
    if (other === undefined) return `${key(row)} exists only in a fresh install`;
    if (other.sql !== row.sql) return `${key(row)} differs: ${whereTextsDiffer(String(row.sql), String(other.sql))}`;
  }
  const extra = upgraded.find((row) => !fresh.some((each) => key(each) === key(row)));
  return extra === undefined ? null : `${key(extra)} exists only after the upgrade`;
}

/** Rows per user table (sqlite_master without SQLite's own objects). */
function rowCounts(driver) {
  const tables = driver.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", []).map((row) => String(row.name));
  return new Map(tables.map((name) => [name, Number(driver.get(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`, []).n)]));
}

/** "tasks: 0 of 4" for every table that exists before and after and holds fewer rows after. */
function lostRows(before, after) {
  return [...before].filter(([name, count]) => after.has(name) && after.get(name) < count).map(([name, count]) => `${name}: ${after.get(name)} of ${count}`);
}

const sameSchema = (first, second) => JSON.stringify(first) === JSON.stringify(second);

/**
 * fixtures: { versioned: [{ version, rel, text }], legacy: [{ name, rel, text }] }. Adds
 * `migration-replay` problems (and `unversioned-data` / `fixture-*` for legacy fixtures); returns the
 * number of databases replayed (0 when replay could not run: the reason is printed as a note).
 */
export async function replayMigrations(ctx, { runner, list, fixtures }) {
  const DatabaseSync = await loadDatabaseSync();
  if (DatabaseSync === null) {
    ctx.note('migration replay skipped: this Node has no node:sqlite (use Node 22.18 or newer)');
    return 0;
  }
  let app;
  try {
    const modules = enableAppImports(ctx.root);
    const { migrateDatabase } = await modules.load(runner);
    const { MIGRATIONS: migrations, BASELINE: baseline } = await modules.load(list);
    app = { migrateDatabase, migrations, baseline: baseline ?? null };
  } catch (error) {
    ctx.add({ file: list, rule: 'migration-replay', message: `the migrations do not load on Node: ${errorText(error).split('\n')[0]}`, fix: 'A step imports nothing but the Migration type and holds literal SQL, and migrations.ts imports only its steps (or pass --no-replay while the data layer is half built).' });
    return 0;
  }
  if (typeof app.migrateDatabase !== 'function' || !Array.isArray(app.migrations)) {
    ctx.add({ file: list, rule: 'migration-replay', message: 'migrateDatabase or MIGRATIONS is not exported', fix: 'Keep the template exports: migrateDatabase in migration-runner.ts, MIGRATIONS in migrations.ts.' });
    return 0;
  }
  const open = () => driverOf(new DatabaseSync(':memory:', { enableForeignKeyConstraints: false }), ':memory:');
  const fresh = open();
  const freshResult = app.migrateDatabase(fresh, app.migrations);
  if (freshResult.kind === 'failed') {
    ctx.add({ file: list, rule: 'migration-replay', message: `a fresh install fails at version ${freshResult.at}: ${freshResult.reason}`, fix: 'Run the migration tests (test/sqlite/) and fix the step; a fresh install runs every step from an empty file.' });
    fresh.close();
    return 1;
  }
  const replay = { ctx, open, app, freshSchema: schemaOf((sql) => fresh.all(sql, [])) };
  fresh.close();
  for (const fixture of fixtures.versioned) replayFixture(replay, fixture, { stamp: null });
  replayLegacy(replay, { list, legacy: fixtures.legacy });
  return 1 + fixtures.versioned.length + fixtures.legacy.length;
}

/** Loads a fixture as a device opens it (foreign keys on), upgrades it, and compares it with a fresh install. */
function replayFixture(replay, fixture, { stamp }) {
  const { ctx, open, app, freshSchema } = replay;
  const label = fixture.name ?? `db-v${fixture.version}`;
  const driver = open();
  const add = (message, fix) => ctx.add({ file: fixture.rel, rule: 'migration-replay', message, fix });
  try {
    try {
      driver.exec(fixture.text.replace(/\r\n/g, '\n'));
    } catch (error) {
      add(`${label}.sql does not load: ${error.message}`, 'Restore the frozen fixture from git.');
      return;
    }
    if (stamp !== null && !stamp(driver)) return;
    driver.exec('PRAGMA foreign_keys = ON');
    const before = rowCounts(driver);
    const result = app.migrateDatabase(driver, app.migrations);
    if (result.kind !== 'migrated' && result.kind !== 'up-to-date') {
      add(`upgrading ${label} ${result.kind === 'failed' ? `fails at version ${result.at}: ${result.reason}` : `ends as ${result.kind}`}`, 'A step must work on every database an older version wrote: fix the step (a new one, if it shipped).');
      return;
    }
    const difference = firstDifference(freshSchema, schemaOf((sql) => driver.all(sql, [])));
    if (difference !== null) {
      add(`upgrading ${label} does not give the fresh schema: ${difference}`, 'A shipped step was edited (old installs never rerun it), or a new step leaves the two paths apart. Restore the shipped step and change the schema in a new version.');
    }
    const integrity = driver.all('PRAGMA integrity_check', []).map((row) => row.integrity_check);
    const orphans = driver.all('PRAGMA foreign_key_check', []);
    if (integrity.length !== 1 || integrity[0] !== 'ok' || orphans.length > 0) {
      add(`upgrading ${label} leaves a broken database (integrity: ${integrity[0]}, ${orphans.length} orphan row(s))`, 'Fix the step so every row still satisfies its constraints and foreign keys after the upgrade.');
    }
    const lost = lostRows(before, rowCounts(driver));
    if (lost.length > 0) {
      add(`upgrading ${label} loses rows (${lost.join(', ')} after the upgrade)`, 'Every row a user saved must survive: a rebuild copies every row and is marked rebuildsTables: true (with foreign keys on, DROP TABLE of a parent deletes its ON DELETE CASCADE children); a row a step must drop goes to an archive table, never away.');
    }
  } finally {
    driver.close();
  }
}

/** The schema `build(driver)` leaves in a new in-memory database, or null when it throws or fails. */
function schemaBuiltBy(open, build) {
  const driver = open();
  try {
    return build(driver) === false ? null : schemaOf((sql) => driver.all(sql, []));
  } catch {
    return null;
  } finally {
    driver.close();
  }
}

/** db-v0-* fixtures: each must be adopted (schema = migrations 1..BASELINE.version or a variant), then upgraded. */
function replayLegacy(replay, { list, legacy }) {
  const { ctx, open, app } = replay;
  const { baseline } = app;
  const variants = Array.isArray(baseline?.variants) ? baseline.variants : [];
  if (legacy.length === 0 && variants.length === 0) return;
  const version = baseline?.version;
  if (!Number.isInteger(version) || version < 1 || version > app.migrations.length) {
    const what = baseline === null ? 'migrations.ts exports no BASELINE' : `BASELINE.version is ${version}, not 1..${app.migrations.length}`;
    for (const fixture of legacy) ctx.add({ file: fixture.rel, rule: 'unversioned-data', message: `${fixture.name}.sql is an unversioned database, but ${what}`, fix: 'Set BASELINE = { version, variants } in migrations.ts: the version whose schema old builds wrote, and the verbatim CREATE text of every other schema they left.' });
    return;
  }
  const candidates = [
    { label: `migrations 1..${version}`, schema: schemaBuiltBy(open, (driver) => app.migrateDatabase(driver, app.migrations.slice(0, version)).kind === 'migrated') },
    ...variants.map((ddl, index) => ({ label: `BASELINE variant ${index + 1}`, schema: schemaBuiltBy(open, (driver) => driver.exec(String(ddl))) })),
  ];
  const matched = new Set();
  for (const fixture of legacy) {
    const stamp = (driver) => {
      const found = Number(driver.get('PRAGMA user_version', []).user_version);
      if (found !== 0) {
        ctx.add({ file: fixture.rel, rule: 'fixture-frozen', message: `${fixture.name}.sql declares user_version ${found}, expected 0`, fix: 'A db-v0-<variant> fixture is an unversioned file as old builds left it: restore it from git.' });
        return false;
      }
      const schema = schemaOf((sql) => driver.all(sql, []));
      const index = candidates.findIndex((candidate) => candidate.schema !== null && sameSchema(candidate.schema, schema));
      if (index === -1) {
        ctx.add({ file: fixture.rel, rule: 'unversioned-data', message: `${fixture.name}.sql would open as unversioned (in memory, every launch): its schema is neither migrations 1..${version} nor a BASELINE variant (${firstDifference(candidates[0].schema ?? [], schema)})`, fix: "Add its CREATE statements, verbatim from the dump, to BASELINE.variants, and rebuild every table it differs in in the step after BASELINE.version." });
        return false;
      }
      matched.add(index);
      driver.exec(`PRAGMA user_version = ${version}`);
      return true;
    };
    replayFixture(replay, fixture, { stamp });
  }
  variants.forEach((_, index) => {
    if (!matched.has(index + 1)) ctx.add({ file: list, rule: 'fixture-missing', message: `BASELINE variant ${index + 1} has no frozen db-v0-<variant>.sql (or its CREATE text does not match the dump)`, fix: 'Freeze a database that population holds (inspect-database --dump src/data/migrations/fixtures/db-v0-<variant>.sql), record its checksum and add it to LEGACY_FIXTURES.' });
  });
}
