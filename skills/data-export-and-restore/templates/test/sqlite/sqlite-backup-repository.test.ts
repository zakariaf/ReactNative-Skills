// test/sqlite/sqlite-backup-repository.test.ts: the backup repository on real SQL, starting from the frozen version-1 database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { consistencyFailure } from '@/data/backup/read-backup';
import { createSqliteBackupRepository } from '@/data/backup/sqlite-backup-repository';
import { migrateDatabase } from '@/data/migrations/migration-runner';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

import type { Result } from '@/core/result';
import type { BackupPayload } from '@/data/backup/backup-schema';
import type { ClosableSqlDriver } from '@/data/sql-driver';

const DB_V1 = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures', 'db-v1.sql');

function valueOf<TValue>(result: Result<TValue, unknown>): TValue {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** A database as a device holds it: the frozen v1 file, upgraded, with the app's foreign keys on. */
function deviceDatabase(sql: string | null = readFileSync(DB_V1, 'utf8')): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  if (sql !== null) driver.exec(sql);
  driver.exec('PRAGMA foreign_keys = ON');
  migrateDatabase(driver, MIGRATIONS);
  return driver;
}

const count = (driver: ClosableSqlDriver, table: string): unknown =>
  driver.get(`SELECT COUNT(*) AS n FROM ${table}`, [])?.['n'];

describe('createSqliteBackupRepository', () => {
  it('reads every backed-up table in id order, and never the excluded tables', () => {
    const repository = createSqliteBackupRepository({
      driver: deviceDatabase(),
      errorLog: createFakeErrorLog(),
    });
    const { payload, skippedRows } = valueOf(repository.readAll());
    expect(Object.keys(payload)).toStrictEqual(['lists', 'tasks']);
    expect(payload.tasks.map((task) => task.id)).toStrictEqual([1, 2, 3, 4]);
    expect(payload.tasks[2]?.title).toBe('شراء الحليب');
    expect(skippedRows).toBe(0);
  });

  it('replaces every row in one transaction and keeps entitlements and the error log', () => {
    const source = valueOf(
      createSqliteBackupRepository({
        driver: deviceDatabase(),
        errorLog: createFakeErrorLog(),
      }).readAll(),
    ).payload;
    const target = deviceDatabase(null);
    target.run("INSERT INTO entitlements (product, is_owned) VALUES ('premium', 1)", []);
    target.run("INSERT INTO lists (id, name, created_at_ms) VALUES (99, 'Old', 1)", []);
    const repository = createSqliteBackupRepository({
      driver: target,
      errorLog: createFakeErrorLog(),
    });
    expect(repository.replaceAll(source)).toStrictEqual({
      ok: true,
      value: { lists: 2, tasks: 4 },
    });
    expect(valueOf(repository.readAll()).payload).toStrictEqual(source);
    expect([count(target, 'entitlements'), count(target, 'lists')]).toStrictEqual([1, 2]);
  });

  it('is idempotent: the same payload twice gives the same rows, not duplicates', () => {
    const driver = deviceDatabase();
    const repository = createSqliteBackupRepository({ driver, errorLog: createFakeErrorLog() });
    const { payload } = valueOf(repository.readAll());
    repository.replaceAll(payload);
    repository.replaceAll(payload);
    expect([count(driver, 'lists'), count(driver, 'tasks')]).toStrictEqual([2, 4]);
  });

  it('rolls back whole when a row fails half-way: every current row is still there', () => {
    const driver = deviceDatabase();
    const errorLog = createFakeErrorLog();
    const repository = createSqliteBackupRepository({ driver, errorLog });
    const before = valueOf(repository.readAll()).payload;
    // readBackup refuses this file (missing-parent); the database refuses it too, as a last line.
    const orphan: BackupPayload = {
      lists: [{ id: 1, name: 'Home', created_at_ms: 0 }],
      tasks: [{ id: 1, list_id: 2, title: 'Orphan', is_done: 0, created_at_ms: 0 }],
    };
    expect(repository.replaceAll(orphan)).toStrictEqual({
      ok: false,
      error: { kind: 'storage', failure: { kind: 'constraint', detail: 'foreign-key' } },
    });
    expect(valueOf(repository.readAll()).payload).toStrictEqual(before);
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['storage']);
  });

  it('refuses a payload that breaks its schema before touching the tables', () => {
    const driver = deviceDatabase();
    const repository = createSqliteBackupRepository({ driver, errorLog: createFakeErrorLog() });
    const broken = { lists: [], tasks: [], entitlements: [] } as unknown as BackupPayload;
    expect(repository.replaceAll(broken)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-input', path: 'entitlements' },
    });
    expect(count(driver, 'tasks')).toBe(4);
  });

  it('skips and counts an unreadable row, and logs the table and field, not the text', () => {
    const driver = deviceDatabase();
    driver.exec(`
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (50, 1, 'private', 7, 1);
      PRAGMA ignore_check_constraints = OFF;`);
    const errorLog = createFakeErrorLog();
    const { payload, skippedRows } = valueOf(
      createSqliteBackupRepository({ driver, errorLog }).readAll(),
    );
    expect([payload.tasks.length, skippedRows]).toStrictEqual([4, 1]);
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'backup skipped an unreadable tasks row: is_done',
    ]);
  });

  it('leaves out the tasks of an unreadable list, so the file still restores', () => {
    const driver = deviceDatabase();
    driver.exec(`
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO lists (id, name, created_at_ms) VALUES (60, '', 1);
      INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (61, 60, 'kept?', 0, 1);
      PRAGMA ignore_check_constraints = OFF;`);
    const errorLog = createFakeErrorLog();
    const { payload, skippedRows } = valueOf(
      createSqliteBackupRepository({ driver, errorLog }).readAll(),
    );
    expect([payload.lists.length, payload.tasks.length, skippedRows]).toStrictEqual([2, 4, 2]);
    expect(consistencyFailure(payload)).toBeNull();
    // entries() lists the newest first.
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'backup skipped 1 tasks rows whose parent was skipped',
      'backup skipped an unreadable lists row: name',
    ]);
  });
});
