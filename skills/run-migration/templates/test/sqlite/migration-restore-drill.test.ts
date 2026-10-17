// test/sqlite/migration-restore-drill.test.ts: the forced-failure drill on real files: a step that fails halfway changes nothing, a committed wrong step is undone by its snapshot, and the previous build leaves a newer file's bytes alone.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openAppDatabase } from '@/data/app-database';
import { snapshotPathFor } from '@/data/database-snapshots';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { contentOf, countsOf } from './database-content';
import { createNodeDatabaseFiles } from './node-database-files';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { restoreSnapshotFiles } from './restore-snapshot-files';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { DatabaseContent } from './database-content';
import type { TempDatabaseFolder } from './temp-database-folder';
import type { OpenAppDatabaseDeps } from '@/data/app-database';
import type { Migration } from '@/data/migrations/migration-runner';
import type { ClosableSqlDriver } from '@/data/sql-driver';

const FIXTURE_DIR = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures');
const LATEST = MIGRATIONS.length;

/** A stand-in for the newest step while the app has only v1. */
const DRILL_PROBE: Migration = {
  version: LATEST + 1,
  name: 'drill-probe',
  up: (driver) => {
    driver.exec('CREATE TABLE drill_probe (id INTEGER PRIMARY KEY) STRICT');
  },
};

/** `step`, made to throw after its SQL ran: what a bug or a full disk does halfway through. */
function failingHalfway(step: Migration): Migration {
  return {
    ...step,
    up: (driver) => {
      step.up(driver);
      throw new Error('forced failure after the step ran');
    },
  };
}

/** The halfway drill's list: the newest real step fails (or the stand-in after v1 does). */
function halfwaySteps(): readonly Migration[] {
  const newest = MIGRATIONS.at(-1);
  return LATEST >= 2 && newest !== undefined
    ? [...MIGRATIONS.slice(0, -1), failingHalfway(newest)]
    : [...MIGRATIONS, failingHalfway(DRILL_PROBE)];
}

/**
 * A step that commits a wrong change: every row of every table deleted. rebuildsTables only turns
 * foreign keys off around it, so parents can go before their children.
 */
function wipeEveryRow(tables: readonly string[]): Migration {
  return {
    version: LATEST + 1,
    name: 'drill-wipe-every-row',
    rebuildsTables: true,
    up: (driver) => {
      for (const table of tables) driver.run(`DELETE FROM "${table}"`, []);
    },
  };
}

describe('migration restore drill', () => {
  let folder: TempDatabaseFolder;
  let opened: ClosableSqlDriver[];
  const file = (): string => folder.file('app.db');
  const deps = (migrations: readonly Migration[]): OpenAppDatabaseDeps => ({
    openDriver: (name) => {
      const driver = createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name));
      let isOpen = true;
      /** The open path closes some drivers itself; closeAll closes the rest exactly once. */
      const tracked: ClosableSqlDriver = {
        ...driver,
        close: () => {
          if (isOpen) driver.close();
          isOpen = false;
        },
      };
      opened.push(tracked);
      return tracked;
    },
    files: createNodeDatabaseFiles(),
    fileName: 'app.db',
    migrations,
    errorLog: createFakeErrorLog(),
  });
  /** Writes the file a device holds at `version` from its frozen fixture. */
  const writeFixture = (version: number): void => {
    const driver = createNodeSqliteSqlDriver(file());
    driver.exec(readFileSync(join(FIXTURE_DIR, `db-v${String(version)}.sql`), 'utf8'));
    driver.close();
  };
  const readContent = (path: string): DatabaseContent => {
    const driver = createNodeSqliteSqlDriver(path);
    const content = contentOf(driver);
    driver.close();
    return content;
  };
  const closeAll = (): void => {
    for (const driver of opened.splice(0)) driver.close();
  };
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
    opened = [];
  });
  afterEach(() => {
    closeAll();
    folder.remove();
  });

  it('leaves the file and its snapshot exactly as they were when the newest step fails halfway', () => {
    const from = Math.max(1, LATEST - 1);
    writeFixture(from);
    const before = readContent(file());
    const database = openAppDatabase(deps(halfwaySteps()));
    expect(database.outcome).toMatchObject({ kind: 'migration-failed', from });
    expect(database.isPersistent).toBe(false);
    closeAll();
    expect(readContent(file())).toStrictEqual(before);
    expect(readContent(snapshotPathFor(file(), from))).toStrictEqual(before);
  });

  it('undoes a committed wrong step by restoring the snapshot taken before it', () => {
    writeFixture(LATEST);
    const before = readContent(file());
    const snapshot = snapshotPathFor(file(), LATEST);
    const steps = [...MIGRATIONS, wipeEveryRow(Object.keys(before.rows))];
    const database = openAppDatabase(deps(steps));
    expect(database.outcome).toStrictEqual({
      kind: 'migrated',
      from: LATEST,
      to: LATEST + 1,
      snapshot,
    });
    expect(Object.values(countsOf(database.driver)).every((count) => count === 0)).toBe(true);
    closeAll();
    restoreSnapshotFiles(file(), snapshot, folder.file('kept'));
    expect(readContent(file())).toStrictEqual(before);
    expect(openAppDatabase(deps(MIGRATIONS)).outcome).toStrictEqual({
      kind: 'ready',
      version: LATEST,
    });
  });

  it('leaves every byte of a newer file alone when the previous build opens it', () => {
    writeFixture(LATEST);
    const bytes = readFileSync(file());
    const before = readContent(file());
    const database = openAppDatabase(deps(MIGRATIONS.slice(0, -1)));
    expect(database.outcome).toStrictEqual({ kind: 'newer-version', found: LATEST });
    expect(database.isPersistent).toBe(false);
    closeAll();
    expect(readContent(file())).toStrictEqual(before);
    // Bytes, not only rows: PRAGMA optimize, ANALYZE or VACUUM change the file without changing a row.
    expect(readFileSync(file()).equals(bytes)).toBe(true);
    expect(existsSync(`${file()}-wal`)).toBe(false);
  });
});
