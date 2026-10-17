// test/direction-guard/kv-direction-guard-adapter.test.ts
// The pending-restart guard on the real expo-sqlite/kv-store code, whose SQL runs on node:sqlite:
// only expo-sqlite's native openDatabaseSync is replaced. It lives in the root test/ folder, the only
// test code with Node types, and reaches kv-store only through the adapter and its SQLite table.
import {
  PENDING_DIRECTION_KEY,
  createKvDirectionGuardAdapter,
} from '@/services/direction-guard/kv-direction-guard-adapter';

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

type NodeSqlite = { readonly DatabaseSync: typeof DatabaseSync };

/** One database per file name, kept across a simulated JS reload (like the files on a phone). */
const mockDatabases = new Map<string, DatabaseSync>();
/** When true, every read fails the way a damaged or locked database file does. */
let isReadFailing = false;

/** The part of expo-sqlite's SQLiteDatabase that kv-store calls, on node:sqlite. */
function mockOpenDatabaseSync(name: string): object {
  const sqlite = jest.requireActual<NodeSqlite>('node:sqlite');
  const db = mockDatabases.get(name) ?? new sqlite.DatabaseSync(':memory:');
  mockDatabases.set(name, db);
  return {
    execSync: (sql: string) => {
      db.exec(sql);
    },
    getFirstSync: (sql: string, ...params: SQLInputValue[]) => {
      if (isReadFailing) throw new Error('disk I/O error');
      const row = db.prepare(sql).get(...params);
      return row === undefined ? null : { ...row };
    },
    runSync: (sql: string, ...params: SQLInputValue[]) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    withTransactionSync: (work: () => void) => {
      db.exec('BEGIN');
      try {
        work();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (name: string) => mockOpenDatabaseSync(name),
}));

/** The value kv-store wrote, read straight from its table. */
function storedValue(): unknown {
  const db = mockDatabases.get('ExpoSQLiteStorage');
  return db?.prepare('SELECT value FROM storage WHERE key = ?').get(PENDING_DIRECTION_KEY)?.[
    'value'
  ];
}

/** Writes a raw value into kv-store's table, as an older or damaged build might have left it. */
function storeRaw(value: string): void {
  createKvDirectionGuardAdapter().writePending(null); // kv-store creates its table on first use
  mockDatabases
    .get('ExpoSQLiteStorage')
    ?.prepare('INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)')
    .run(PENDING_DIRECTION_KEY, value);
}

describe('createKvDirectionGuardAdapter', () => {
  afterEach(() => {
    isReadFailing = false;
    createKvDirectionGuardAdapter().writePending(null);
  });

  it('has no pending restart on a fresh install', () => {
    expect(createKvDirectionGuardAdapter().readPending()).toBeNull();
  });

  it('writes the pending direction into the kv-store table', () => {
    expect(createKvDirectionGuardAdapter().writePending('rtl')).toStrictEqual({
      ok: true,
      value: undefined,
    });

    expect(storedValue()).toBe('rtl');
    expect(createKvDirectionGuardAdapter().readPending()).toBe('rtl');
  });

  it('keeps the marker across a JS reload (a fresh kv-store module on the same file)', () => {
    createKvDirectionGuardAdapter().writePending('ltr');

    jest.isolateModules(() => {
      const reloaded = jest.requireActual<{
        readonly createKvDirectionGuardAdapter: typeof createKvDirectionGuardAdapter;
      }>('@/services/direction-guard/kv-direction-guard-adapter');
      expect(reloaded.createKvDirectionGuardAdapter().readPending()).toBe('ltr');
    });
  });

  it('clears the marker with null', () => {
    const guard = createKvDirectionGuardAdapter();
    guard.writePending('rtl');
    guard.writePending(null);

    expect(guard.readPending()).toBeNull();
    expect(storedValue()).toBeUndefined();
  });

  it('reads anything but ltr or rtl as no pending restart', () => {
    storeRaw('sideways');

    expect(createKvDirectionGuardAdapter().readPending()).toBeNull();
  });

  it('reports a failed read as unreadable, never as no pending restart', () => {
    const guard = createKvDirectionGuardAdapter();
    guard.writePending('rtl');
    isReadFailing = true;

    expect(guard.readPending()).toBe('unreadable');
  });
});
