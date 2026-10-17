// test/sqlite/migration-paths.test.ts: every from-to path: an empty file and each frozen fixture upgraded to every later version give that version's frozen schema and keep every row.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrateDatabase } from '@/data/migrations/migration-runner';
import { LATEST_DB_VERSION, MIGRATIONS } from '@/data/migrations/migrations';

import { countsOf, lostRows } from './database-content';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { healthOf, schemaOf } from './sqlite-schema';

import type { ClosableSqlDriver } from '@/data/sql-driver';

const FIXTURE_DIR = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures');

/** Versions with a frozen db-vN.sql, read from the folder so a new fixture is covered at once. */
const FROZEN: readonly number[] = readdirSync(FIXTURE_DIR)
  .flatMap((name) => {
    const version = /^db-v([1-9]\d*)\.sql$/.exec(name)?.[1];
    return version === undefined ? [] : [Number(version)];
  })
  .sort((first, second) => first - second);

/**
 * Every [from, to]: from is 0 (a fresh install) or a frozen version, to is every later version.
 * A user who skipped updates runs from-to paths nobody tapped through; each one is proven here.
 */
const PATHS: readonly (readonly [number, number])[] = [0, ...FROZEN].flatMap((from) =>
  Array.from({ length: Math.max(0, LATEST_DB_VERSION - from) }, (_, index) => {
    const to = from + 1 + index;
    return [from, to] as const;
  }),
);

/** The database as a device holds it at `version` (0: a new, empty file), foreign keys on. */
function load(version: number): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  if (version > 0) {
    const sql = readFileSync(join(FIXTURE_DIR, `db-v${String(version)}.sql`), 'utf8');
    driver.exec(sql.replace(/\r\n/g, '\n'));
  }
  driver.exec('PRAGMA foreign_keys = ON');
  return driver;
}

describe('migration paths', () => {
  it('has a frozen fixture for every version', () => {
    expect(FROZEN).toStrictEqual(
      Array.from({ length: LATEST_DB_VERSION }, (_, index) => index + 1),
    );
  });

  it.each(PATHS)('upgrades v%i to v%i into exactly the frozen target schema', (from, to) => {
    const driver = load(from);
    const target = load(to);
    const before = countsOf(driver);
    expect(migrateDatabase(driver, MIGRATIONS.slice(0, to))).toStrictEqual({
      kind: 'migrated',
      from,
      to,
    });
    expect(schemaOf(driver)).toStrictEqual(schemaOf(target));
    expect(healthOf(driver)).toStrictEqual({ integrity: ['ok'], orphans: 0 });
    expect(lostRows(before, countsOf(driver))).toStrictEqual({});
    driver.close();
    target.close();
  });
});
