// test/sqlite/sql-driver-contract.test.ts: both SqlDriver implementations keep one contract, run on node:sqlite.
import { DatabaseSync } from 'node:sqlite';

import { wrapSyncSqliteDatabase } from '@/data/expo-sqlite-sql-driver';
import { NESTED_TRANSACTION_MESSAGE } from '@/data/sql-driver';

import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';

import type { SyncSqliteDatabase } from '@/data/expo-sqlite-sql-driver';
import type { ClosableSqlDriver, SqlRow } from '@/data/sql-driver';
import type { SQLiteBindValue } from 'expo-sqlite';
import type { SQLInputValue } from 'node:sqlite';

/** The driver binds strings, numbers and null only; the other expo-sqlite values map as SQLite stores them. */
function toNodeValue(value: SQLiteBindValue): SQLInputValue {
  if (typeof value === 'boolean') return Number(value);
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

/** expo-sqlite returns plain objects; node:sqlite rows have a null prototype. */
const plain = (row: object): SqlRow => ({ ...row });

/**
 * expo-sqlite's synchronous database, played by node:sqlite with the device's defaults (foreign
 * keys off), so the device driver's own transaction logic runs in Jest.
 */
function syncDatabaseOnNode(path: string): SyncSqliteDatabase {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const bind = (params: SQLiteBindValue[]): SQLInputValue[] => params.map(toNodeValue);
  return {
    databasePath: path,
    execSync: (source) => {
      db.exec(source);
    },
    runSync: (source, params) => {
      const result = db.prepare(source).run(...bind(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getFirstSync: (source, params) => {
      const row = db.prepare(source).get(...bind(params));
      return row === undefined ? null : plain(row);
    },
    getAllSync: (source, params) =>
      db
        .prepare(source)
        .all(...bind(params))
        .map(plain),
    isInTransactionSync: () => db.isTransaction,
    closeSync: () => {
      db.close();
    },
  };
}

const DRIVERS: readonly (readonly [string, (path: string) => ClosableSqlDriver])[] = [
  ['the node:sqlite driver', createNodeSqliteSqlDriver],
  ['the expo-sqlite driver', (path) => wrapSyncSqliteDatabase(syncDatabaseOnNode(path))],
];

const CREATE_NOTES = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT';
const INSERT_NOTE = 'INSERT INTO notes (body) VALUES (?)';
const COUNT_NOTES = 'SELECT COUNT(*) AS n FROM notes';

describe.each(DRIVERS)('%s', (_name, open) => {
  let driver: ClosableSqlDriver;
  beforeEach(() => {
    driver = open(':memory:');
    driver.exec(CREATE_NOTES);
  });
  afterEach(() => {
    driver.close();
  });

  it('returns plain rows, null for no row, and what a write changed', () => {
    expect(driver.run(INSERT_NOTE, ['first'])).toStrictEqual({ changes: 1, lastInsertRowId: 1 });
    expect(driver.get('SELECT id, body FROM notes', [])).toStrictEqual({ id: 1, body: 'first' });
    expect(driver.get('SELECT id FROM notes WHERE id = ?', [9])).toBeNull();
    expect(driver.all('SELECT body FROM notes', [])).toStrictEqual([{ body: 'first' }]);
  });

  it('commits every statement of a transaction together', () => {
    driver.transaction(() => {
      driver.run(INSERT_NOTE, ['a']);
      driver.run(INSERT_NOTE, ['b']);
    });
    expect(driver.get(COUNT_NOTES, [])).toStrictEqual({ n: 2 });
  });

  it('rolls back every statement when the work throws, and rethrows that error', () => {
    expect(() => {
      driver.transaction(() => {
        driver.run(INSERT_NOTE, ['a']);
        throw new Error('crash mid-change');
      });
    }).toThrow('crash mid-change');
    expect(driver.get(COUNT_NOTES, [])).toStrictEqual({ n: 0 });
  });

  it('refuses a nested transaction, and the outer change rolls back whole', () => {
    const insertInner = (): void => {
      driver.run(INSERT_NOTE, ['inner']);
    };
    const outerWithNested = (): void => {
      driver.run(INSERT_NOTE, ['outer']);
      driver.transaction(insertInner);
    };
    expect(() => {
      driver.transaction(outerWithNested);
    }).toThrow(NESTED_TRANSACTION_MESSAGE);
    expect(driver.get(COUNT_NOTES, [])).toStrictEqual({ n: 0 });
    driver.transaction(() => {
      driver.run(INSERT_NOTE, ['after']);
    });
    expect(driver.get(COUNT_NOTES, [])).toStrictEqual({ n: 1 });
  });

  it('rethrows a failed COMMIT itself and leaves no transaction open', () => {
    driver.exec(`
      CREATE TABLE lists (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE items (list_id INTEGER REFERENCES lists (id) DEFERRABLE INITIALLY DEFERRED) STRICT;
      PRAGMA foreign_keys = ON;`);
    expect(() => {
      driver.transaction(() => {
        driver.run('INSERT INTO items (list_id) VALUES (?)', [7]);
      });
    }).toThrow('FOREIGN KEY constraint failed');
    expect(driver.get('SELECT COUNT(*) AS n FROM items', [])).toStrictEqual({ n: 0 });
    expect(() => {
      driver.transaction(() => undefined);
    }).not.toThrow();
  });

  it('leaves foreign keys off until the app turns them on, as on a device', () => {
    expect(driver.get('PRAGMA foreign_keys', [])).toStrictEqual({ foreign_keys: 0 });
  });
});
