// test/sqlite/backup-round-trip.test.ts: export, restore, export again gives the same bytes; every frozen backup still restores, and its upgrade matches the migrations.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BACKUP_SCHEMA_VERSION, checkEnvelope, encodeBackup } from '@/data/backup/backup-envelope';
import { BACKUP_TABLES_IN_WRITE_ORDER } from '@/data/backup/backup-schema';
import { readBackup } from '@/data/backup/read-backup';
import { createSqliteBackupRepository } from '@/data/backup/sqlite-backup-repository';
import { migrateDatabase } from '@/data/migrations/migration-runner';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

import type { JsonObject } from '@/core/portable/canonical-json';
import type { Result } from '@/core/result';
import type { BackupRepository } from '@/data/backup/backup-repository';
import type { ClosableSqlDriver, SqlValue } from '@/data/sql-driver';

const SRC = join(__dirname, '..', '..', 'src', 'data');
const META = { appVersion: '9.9.9', exportedAtMs: 1_790_000_000_000 };

/** Every backup format version ever shipped, as the file that version wrote. Append only. */
const FIXTURES = [{ name: 'backup-v1', version: 1 }] as const;

function valueOf<TValue>(result: Result<TValue, unknown>): TValue {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** A device database at `version` (all migrations by default), foreign keys on as the app sets them. */
function database(version = MIGRATIONS.length, sql: string | null = null): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  if (sql !== null) driver.exec(sql);
  driver.exec('PRAGMA foreign_keys = ON');
  migrateDatabase(driver, MIGRATIONS.slice(0, version));
  return driver;
}

const repositoryOn = (driver: ClosableSqlDriver): BackupRepository =>
  createSqliteBackupRepository({ driver, errorLog: createFakeErrorLog() });

const exportOf = (repository: BackupRepository): string =>
  encodeBackup(valueOf(repository.readAll()).payload, META);

/**
 * Test-only: inserts a payload's rows into a database at an OLD schema by their own column names.
 * App code never builds SQL from names; this is how the parity test writes what an old app held.
 */
function insertRaw(driver: ClosableSqlDriver, payload: JsonObject): void {
  driver.transaction(() => {
    for (const table of BACKUP_TABLES_IN_WRITE_ORDER) {
      const rows = payload[table];
      for (const row of Array.isArray(rows) ? (rows as JsonObject[]) : []) {
        const columns = Object.keys(row);
        const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
        driver.run(
          sql,
          columns.map((column) => row[column] as SqlValue),
        );
      }
    }
  });
}

describe('backup round trip', () => {
  it('exports, restores into an empty database, and exports the same bytes again', () => {
    const first = exportOf(
      repositoryOn(
        database(
          MIGRATIONS.length,
          readFileSync(join(SRC, 'migrations', 'fixtures', 'db-v1.sql'), 'utf8'),
        ),
      ),
    );
    const restored = repositoryOn(database());
    valueOf(restored.replaceAll(valueOf(readBackup(first)).payload));
    expect(exportOf(restored)).toBe(first);
  });

  it.each(FIXTURES)(
    'restores the frozen $name and exports exactly its rows',
    ({ name, version }) => {
      const text = readFileSync(join(SRC, 'backup', 'fixtures', `${name}.json`), 'utf8');
      const decoded = valueOf(readBackup(text));
      expect(decoded.header.schemaVersion).toBe(version);
      const repository = repositoryOn(database());
      valueOf(repository.replaceAll(decoded.payload));
      expect(valueOf(repository.readAll()).payload).toStrictEqual(decoded.payload);
    },
  );

  it('upgrades every older frozen backup exactly as the migrations upgrade the same rows (parity)', () => {
    const older = FIXTURES.filter((fixture) => fixture.version < BACKUP_SCHEMA_VERSION);
    for (const { name, version } of older) {
      const text = readFileSync(join(SRC, 'backup', 'fixtures', `${name}.json`), 'utf8');
      const old = database(version);
      insertRaw(old, valueOf(checkEnvelope(text)).payload);
      migrateDatabase(old, MIGRATIONS);
      const migrated = valueOf(repositoryOn(old).readAll()).payload;
      expect(migrated).toStrictEqual(valueOf(readBackup(text)).payload);
    }
  });
});
