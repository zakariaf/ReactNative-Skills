// test/sqlite/migration-fixtures.test.ts: every frozen database fixture stays unchanged and upgrades to exactly the fresh schema, keeping every row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isAdoptable } from '@/data/app-database';
import { fnv1a32 } from '@/data/checksum';
import { userTables } from '@/data/database-schema';
import { FIXTURE_CHECKSUMS } from '@/data/migrations/fixtures/fixture-checksums';
import { migrateDatabase } from '@/data/migrations/migration-runner';
import { BASELINE, LATEST_DB_VERSION, MIGRATIONS } from '@/data/migrations/migrations';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { healthOf, schemaOf } from './sqlite-schema';

import type { ClosableSqlDriver, SqlDriver } from '@/data/sql-driver';

const FIXTURE_DIR = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures');

/** Every schema version ever shipped, as the database that version wrote. Append only. */
const FIXTURES = [{ name: 'db-v1', version: 1 }] as const;

/**
 * Only when adopting (BASELINE in migrations.ts): one frozen db-v0-<variant> dump per schema that
 * older builds left at user_version 0. Each must be adopted and upgraded like db-v1. Append only.
 */
const LEGACY_FIXTURES: readonly (keyof typeof FIXTURE_CHECKSUMS)[] = [];

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.sql`), 'utf8').replace(/\r\n/g, '\n');
}

/** The fixture loaded the way a device opens it: foreign keys on, as the app's pragmas set them. */
function loadFixture(name: string): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  driver.exec(fixtureText(name));
  driver.exec('PRAGMA foreign_keys = ON');
  return driver;
}

function freshSchema(): readonly unknown[] {
  const driver = createNodeSqliteSqlDriver(':memory:');
  migrateDatabase(driver, MIGRATIONS);
  const schema = schemaOf(driver);
  driver.close();
  return schema;
}

function rowCounts(driver: SqlDriver): Readonly<Record<string, number>> {
  return Object.fromEntries(
    userTables(driver).map((table) => [
      table,
      Number(driver.get(`SELECT COUNT(*) AS n FROM "${table}"`, [])?.['n']),
    ]),
  );
}

/** Tables that exist before and after the upgrade and hold fewer rows after it: '<after> of <before>'. */
function lostRows(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(before)
      .filter(([table, count]) => table in after && (after[table] ?? 0) < count)
      .map(([table, count]) => [table, `${String(after[table])} of ${String(count)}`]),
  );
}

const UPGRADED = ['migrated', 'up-to-date'];

describe('database fixtures', () => {
  it('covers every shipped version once', () => {
    expect(FIXTURES.map((fixture) => fixture.version)).toStrictEqual(
      Array.from({ length: LATEST_DB_VERSION }, (_, index) => index + 1),
    );
  });

  it.each([...FIXTURES.map((fixture) => fixture.name), ...LEGACY_FIXTURES])(
    'keeps %s frozen',
    (name) => {
      expect(fnv1a32(fixtureText(name))).toBe(FIXTURE_CHECKSUMS[name]);
    },
  );

  it.each(FIXTURES)('upgrades $name to exactly the schema a fresh install gets', ({ name }) => {
    const driver = loadFixture(name);
    expect(UPGRADED).toContain(migrateDatabase(driver, MIGRATIONS).kind);
    expect(driver.get('PRAGMA user_version', [])).toStrictEqual({
      user_version: LATEST_DB_VERSION,
    });
    expect(schemaOf(driver)).toStrictEqual(freshSchema());
    driver.close();
  });

  it.each(FIXTURES)('keeps every row of $name, readable and consistent', ({ name }) => {
    const driver = loadFixture(name);
    const before = rowCounts(driver);
    expect(UPGRADED).toContain(migrateDatabase(driver, MIGRATIONS).kind);
    expect(healthOf(driver)).toStrictEqual({ integrity: ['ok'], orphans: 0 });
    expect(lostRows(before, rowCounts(driver))).toStrictEqual({});
    driver.close();
  });

  it('adopts every legacy fixture and upgrades it to the fresh schema without losing a row', () => {
    for (const name of LEGACY_FIXTURES) {
      const driver = loadFixture(name);
      const deps = { openDriver: createNodeSqliteSqlDriver, migrations: MIGRATIONS };
      expect(isAdoptable(driver, { ...deps, baseline: BASELINE })).toBe(true);
      const before = rowCounts(driver);
      driver.exec(`PRAGMA user_version = ${String(BASELINE?.version ?? 0)}`);
      expect(migrateDatabase(driver, MIGRATIONS).kind).toBe('migrated');
      expect(schemaOf(driver)).toStrictEqual(freshSchema());
      expect(lostRows(before, rowCounts(driver))).toStrictEqual({});
      driver.close();
    }
  });
});
