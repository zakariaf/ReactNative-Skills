// test/sqlite/sqlite-document-store.test.ts: the document slots on real SQL: both slots in one transaction, restore, quarantine, rollback.
import { openAppDatabase } from '@/data/app-database';
import { encodeAppDocument } from '@/data/document/document-codec';
import { planLoad } from '@/data/document/document-load-plan';
import { DOCUMENT_SLOTS_DDL } from '@/data/document/document-tables';
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';
import { createSqliteDocumentStore } from '@/data/document/sqlite-document-store';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeDatabaseFiles } from './node-database-files';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { AppDatabase } from '@/data/app-database';
import type { Migration } from '@/data/migrations/migration-runner';

const APP_ID = 'tasks-app';
const META = { appVersion: '1.0.0', writtenAtMs: 1_790_000_000_000, writeCount: 1 };
/** What the app's own vNNNN-create-document-slots.ts holds, as a literal. */
const CREATE_DOCUMENT_SLOTS: Migration = {
  version: 1,
  name: 'create-document-slots',
  up: (driver) => {
    driver.exec(DOCUMENT_SLOTS_DDL);
  },
};

describe('createSqliteDocumentStore', () => {
  let folder: TempDatabaseFolder;
  const open = (): AppDatabase =>
    openAppDatabase({
      openDriver: (name) =>
        createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
      files: createNodeDatabaseFiles(),
      fileName: 'app.db',
      migrations: [CREATE_DOCUMENT_SLOTS],
      errorLog: createFakeErrorLog(),
    });
  const record = encodeAppDocument(createDefaultAppDocument(APP_ID), META);
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
  });
  afterEach(() => {
    folder.remove();
  });

  it('reloads a document written to current and backup', () => {
    createSqliteDocumentStore(open().driver).write({ current: record, backup: record });
    const reopened = createSqliteDocumentStore(open().driver);
    const plan = planLoad({
      current: reopened.read('current'),
      backup: reopened.read('backup'),
      appId: APP_ID,
    });
    expect(plan.outcome).toStrictEqual({ kind: 'loaded' });
    expect(plan.doc).toStrictEqual(createDefaultAppDocument(APP_ID));
  });

  it('restores the backup when current is damaged and quarantines a copy of current', () => {
    const database = open();
    const store = createSqliteDocumentStore(database.driver);
    store.write({ current: { ...record, payload: '{"broken":' }, backup: record });
    const plan = planLoad({
      current: store.read('current'),
      backup: store.read('backup'),
      appId: APP_ID,
    });
    expect(plan.outcome).toStrictEqual({ kind: 'restored-from-backup', reason: 'checksum' });
    store.quarantine('current', 'checksum', 1);
    expect(database.driver.get('SELECT COUNT(*) AS n FROM document_quarantine', [])).toStrictEqual({
      n: 1,
    });
    expect(store.read('current')?.payload).toBe('{"broken":');
  });

  it('keeps the newest ten quarantined rows', () => {
    const database = open();
    const store = createSqliteDocumentStore(database.driver);
    store.write({ current: record });
    for (let index = 0; index < 12; index += 1)
      store.quarantine('current', `round ${String(index)}`, index);
    expect(database.driver.get('SELECT COUNT(*) AS n FROM document_quarantine', [])).toStrictEqual({
      n: 10,
    });
  });

  it('rolls back a failed transaction and keeps the old payload', () => {
    const database = open();
    const store = createSqliteDocumentStore(database.driver);
    store.write({ current: record });
    expect(() => {
      database.driver.transaction(() => {
        database.driver.run('UPDATE document_slots SET payload = ? WHERE slot = ?', [
          'x',
          'current',
        ]);
        throw new Error('crash mid-write');
      });
    }).toThrow('crash mid-write');
    expect(store.read('current')?.payload).toBe(record.payload);
  });
});
