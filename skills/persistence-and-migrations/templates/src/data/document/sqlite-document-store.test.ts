// src/data/document/sqlite-document-store.test.ts: the store's own decisions over a scripted driver (the SQL runs on node:sqlite in test/sqlite/).
import { createSqliteDocumentStore } from './sqlite-document-store';

import type { SqlDriver, SqlRow } from '@/data/sql-driver';

function scriptedDriver(row: SqlRow | null): SqlDriver & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exec: (sql) => {
      calls.push(`exec ${sql.trim().slice(0, 6)}`);
    },
    run: (sql) => {
      calls.push(`run ${sql.trim().slice(0, 6)}`);
      return { changes: 1, lastInsertRowId: 1 };
    },
    get: () => row,
    all: () => [],
    transaction: (work) => {
      calls.push('begin');
      work();
      calls.push('commit');
    },
  };
}

const RECORD = {
  schemaVersion: 1,
  appVersion: '1.0.0',
  writtenAtMs: 1,
  writeCount: 1,
  checksum: 'x',
  payload: '{}',
};

describe('createSqliteDocumentStore', () => {
  it('reads a row of an unexpected shape as no row at all', () => {
    const driver = scriptedDriver({ schema_version: '1', payload: 7 });
    expect(createSqliteDocumentStore(driver).read('current')).toBeNull();
  });

  it('writes both slots inside one transaction', () => {
    const driver = scriptedDriver(null);
    createSqliteDocumentStore(driver).write({ current: RECORD, backup: RECORD });
    expect(driver.calls).toStrictEqual(['begin', 'run INSERT', 'run INSERT', 'commit']);
  });

  it('copies a quarantined row and trims the table in one transaction', () => {
    const driver = scriptedDriver(null);
    createSqliteDocumentStore(driver).quarantine('current', 'checksum', 5);
    expect(driver.calls).toStrictEqual(['begin', 'run INSERT', 'run DELETE', 'commit']);
  });
});
