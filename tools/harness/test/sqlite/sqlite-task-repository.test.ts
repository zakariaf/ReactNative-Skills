// test/sqlite/sqlite-task-repository.test.ts: the Tasks repository on real SQL, through the app's own open path.
import { openAppDatabase } from '@/data/app-database';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createSqliteTaskRepository } from '@/data/tasks/sqlite-task-repository';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeDatabaseFiles } from './node-database-files';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { Result } from '@/core/result';
import type { AppDatabase } from '@/data/app-database';
import type { FakeErrorLog } from '@/services/error-log/fake-error-log';

function valueOf<TValue>(result: Result<TValue, unknown>): TValue {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('createSqliteTaskRepository', () => {
  let folder: TempDatabaseFolder;
  const open = (): AppDatabase =>
    openAppDatabase({
      openDriver: (name) =>
        createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
      files: createNodeDatabaseFiles(),
      fileName: 'app.db',
      migrations: MIGRATIONS,
      errorLog: createFakeErrorLog(),
    });
  const repositoryOn = (database: AppDatabase, errorLog: FakeErrorLog = createFakeErrorLog()) =>
    createSqliteTaskRepository({ driver: database.driver, clock: { nowMs: () => 7 }, errorLog });
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
  });
  afterEach(() => {
    folder.remove();
  });

  it('adds lists and tasks and reads them back in order', () => {
    const repo = repositoryOn(open());
    const work = valueOf(repo.addList({ name: 'Work' }));
    const home = valueOf(repo.addList({ name: '  Home ' }));
    const task = valueOf(repo.addTask({ listId: home.id, title: 'Water the plants' }));
    expect(valueOf(repo.lists()).map((list) => list.name)).toStrictEqual(['Home', 'Work']);
    expect(valueOf(repo.tasksOf(home.id))).toStrictEqual([task]);
    expect(valueOf(repo.tasksOf(work.id))).toStrictEqual([]);
    expect(task).toStrictEqual({
      id: 1,
      listId: home.id,
      title: 'Water the plants',
      isDone: false,
      createdAtMs: 7,
    });
  });

  it('commits a change that a reopened database reads back', () => {
    const first = repositoryOn(open());
    const list = valueOf(first.addList({ name: 'Home' }));
    const task = valueOf(first.addTask({ listId: list.id, title: 'Buy milk' }));
    expect(first.setDone(task.id, true)).toStrictEqual({ ok: true, value: undefined });
    expect(valueOf(repositoryOn(open()).tasksOf(list.id))[0]?.isDone).toBe(true);
  });

  it('returns invalid input as a failure naming the field, and writes nothing', () => {
    const repo = repositoryOn(open());
    const list = valueOf(repo.addList({ name: 'Home' }));
    expect(repo.addTask({ listId: list.id, title: '   ' })).toStrictEqual({
      ok: false,
      error: { kind: 'task-input-invalid', field: 'title' },
    });
    expect(repo.addList({ name: 'x'.repeat(81) })).toStrictEqual({
      ok: false,
      error: { kind: 'task-input-invalid', field: 'name' },
    });
    expect([valueOf(repo.lists()).length, valueOf(repo.tasksOf(list.id))]).toStrictEqual([1, []]);
  });

  it('refuses an id that is not a row id before it touches storage', () => {
    const repo = repositoryOn(open());
    expect(repo.removeList(0)).toStrictEqual({
      ok: false,
      error: { kind: 'task-input-invalid', field: '(input)' },
    });
    expect(repo.setDone(1.5, true)).toStrictEqual({
      ok: false,
      error: { kind: 'task-input-invalid', field: 'taskId' },
    });
  });

  it('marks a done task not done again', () => {
    const repo = repositoryOn(open());
    const list = valueOf(repo.addList({ name: 'Home' }));
    const task = valueOf(repo.addTask({ listId: list.id, title: 'Buy milk' }));
    repo.setDone(task.id, true);
    expect(repo.setDone(task.id, false)).toStrictEqual({ ok: true, value: undefined });
    expect(valueOf(repo.tasksOf(list.id))[0]?.isDone).toBe(false);
  });

  it('returns storage-unavailable from removeList and setDone when a write cannot run', () => {
    const database = open();
    const errorLog = createFakeErrorLog();
    const repo = repositoryOn(database, errorLog);
    const list = valueOf(repo.addList({ name: 'Home' }));
    database.driver.exec('DROP TABLE tasks');
    const unavailable = { ok: false, error: { kind: 'storage-unavailable', code: 1 } };
    expect(repo.removeList(list.id)).toStrictEqual(unavailable);
    expect(repo.setDone(1, true)).toStrictEqual(unavailable);
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['storage', 'storage']);
    expect(valueOf(repo.lists())).toHaveLength(1);
  });

  it('names the missing list when foreign keys refuse a task, and the missing task on update', () => {
    const repo = repositoryOn(open());
    expect(repo.addTask({ listId: 42, title: 'Buy milk' })).toStrictEqual({
      ok: false,
      error: { kind: 'list-not-found', listId: 42 },
    });
    expect(repo.setDone(42, true)).toStrictEqual({
      ok: false,
      error: { kind: 'task-not-found', taskId: 42 },
    });
    expect(repo.removeList(42)).toStrictEqual({
      ok: false,
      error: { kind: 'list-not-found', listId: 42 },
    });
  });

  it('removes a list together with its tasks', () => {
    const database = open();
    const repo = repositoryOn(database);
    const list = valueOf(repo.addList({ name: 'Home' }));
    repo.addTask({ listId: list.id, title: 'Buy milk' });
    expect(repo.removeList(list.id)).toStrictEqual({ ok: true, value: undefined });
    expect(database.driver.get('SELECT COUNT(*) AS n FROM tasks', [])).toStrictEqual({ n: 0 });
    expect(valueOf(repo.lists())).toStrictEqual([]);
  });

  it('returns storage-full when the disk is full, and does not log an expected failure', () => {
    const database = open();
    const errorLog = createFakeErrorLog();
    const repo = repositoryOn(database, errorLog);
    const list = valueOf(repo.addList({ name: 'Home' }));
    const pages = Number(database.driver.get('PRAGMA page_count', [])?.['page_count']);
    database.driver.exec(`PRAGMA max_page_count = ${String(pages)}`);
    const titles = Array.from({ length: 400 }, (_, index) => `Task ${String(index)} `.repeat(10));
    const failures = titles
      .map((title) => repo.addTask({ listId: list.id, title }))
      .filter((result) => !result.ok);
    expect(failures[0]).toStrictEqual({ ok: false, error: { kind: 'storage-full' } });
    expect(errorLog.recorded).toStrictEqual([]);
  });

  it('records an unexpected storage error with the raw error and returns storage-unavailable', () => {
    const database = open();
    const errorLog = createFakeErrorLog();
    const repo = repositoryOn(database, errorLog);
    database.driver.exec('DROP TABLE tasks');
    expect(repo.tasksOf(1)).toStrictEqual({
      ok: false,
      error: { kind: 'storage-unavailable', code: 1 },
    });
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['storage']);
    expect(errorLog.recorded[0]?.error).toHaveProperty('message', 'no such table: tasks');
  });

  it('skips an unreadable row, logs it, and still lists the others', () => {
    const database = open();
    const errorLog = createFakeErrorLog();
    const repo = repositoryOn(database, errorLog);
    const list = valueOf(repo.addList({ name: 'Home' }));
    repo.addTask({ listId: list.id, title: 'Buy milk' });
    database.driver.exec(`
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO tasks (list_id, title, is_done, created_at_ms) VALUES (${String(list.id)}, 'Bad', 7, 1);
      PRAGMA ignore_check_constraints = OFF;`);
    expect(valueOf(repo.tasksOf(list.id)).map((task) => task.title)).toStrictEqual(['Buy milk']);
    expect(errorLog.entries()).toStrictEqual([
      { atMs: 0, source: 'storage', message: 'unreadable tasks row: is_done' },
    ]);
  });
});
