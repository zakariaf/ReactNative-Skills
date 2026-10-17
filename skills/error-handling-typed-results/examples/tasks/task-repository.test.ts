// test/integration/data/task-repository.test.ts (example: a shape to imitate, never copied)
// The repository on real SQL (node:sqlite behind the SqlDriver port, persistence-and-migrations'
// test driver): the person's duplicate title is an expected failure and is not recorded; a reused id
// is a bug, so it becomes storage-unavailable and the raw error reaches the error log.
import { createTaskRepository } from '@/data/tasks/task-repository';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createNodeSqliteSqlDriver } from '@test/sqlite/node-sqlite-sql-driver';

import type { ClosableSqlDriver } from '@/data/sql-driver';

const CREATE_TASKS =
  'CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, is_done INTEGER NOT NULL)';

describe('createTaskRepository', () => {
  let driver: ClosableSqlDriver;

  beforeEach(() => {
    driver = createNodeSqliteSqlDriver(':memory:');
    driver.exec(CREATE_TASKS);
  });

  afterEach(() => {
    driver.close();
  });

  it('returns task-title-taken for a duplicate title and records nothing', () => {
    const errorLog = createFakeErrorLog();
    const repository = createTaskRepository({ driver, errorLog });

    expect(repository.add({ id: 'task-1', title: 'Buy milk' }).ok).toBe(true);
    const duplicate = repository.add({ id: 'task-2', title: ' Buy milk ' });

    expect(duplicate).toStrictEqual({
      ok: false,
      error: { kind: 'task-title-taken', title: 'Buy milk' },
    });
    expect(errorLog.recorded).toStrictEqual([]);
  });

  it('treats a reused id as a defect: storage-unavailable, with the raw error recorded', () => {
    const errorLog = createFakeErrorLog();
    const repository = createTaskRepository({ driver, errorLog });

    expect(repository.add({ id: 'task-1', title: 'Buy milk' }).ok).toBe(true);
    const clash = repository.add({ id: 'task-1', title: 'Call the bank' });

    expect(clash).toStrictEqual({ ok: false, error: { kind: 'storage-unavailable', code: 19 } });
    // The raw error, unchanged (node:sqlite's errors come from another realm, so no instanceof).
    expect(errorLog.recorded).toHaveLength(1);
    expect(errorLog.recorded[0]).toMatchObject({
      source: 'storage',
      error: { message: 'UNIQUE constraint failed: tasks.id' },
    });
  });
});
