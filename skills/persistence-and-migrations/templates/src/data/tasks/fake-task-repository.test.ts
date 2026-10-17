// src/data/tasks/fake-task-repository.test.ts: the fake behaves like the SQLite adapter for the cases tests rely on.
import { createFakeTaskRepository } from './fake-task-repository';

import type { Result } from '@/core/result';

/** The value of an ok Result; a test that expects success fails loudly on a failure. */
function valueOf<TValue>(result: Result<TValue, unknown>): TValue {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('createFakeTaskRepository', () => {
  it('keeps lists in name order and tasks per list', () => {
    const repo = createFakeTaskRepository({ nowMs: () => 5 });
    const work = valueOf(repo.addList({ name: 'Work' }));
    const home = valueOf(repo.addList({ name: ' Home ' }));
    repo.addTask({ listId: home.id, title: 'Water the plants' });
    expect(valueOf(repo.lists()).map((list) => list.name)).toStrictEqual(['Home', 'Work']);
    expect(repo.tasksOf(home.id)).toStrictEqual({
      ok: true,
      value: [{ id: 3, listId: home.id, title: 'Water the plants', isDone: false, createdAtMs: 5 }],
    });
    expect(repo.tasksOf(work.id)).toStrictEqual({ ok: true, value: [] });
  });

  it('returns the adapter failures for invalid input, a missing list and a missing task', () => {
    const repo = createFakeTaskRepository();
    const list = valueOf(repo.addList({ name: 'Home' }));
    expect(repo.addTask({ listId: list.id, title: '   ' })).toStrictEqual({
      ok: false,
      error: { kind: 'task-input-invalid', field: 'title' },
    });
    expect(repo.addTask({ listId: 99, title: 'Buy milk' })).toStrictEqual({
      ok: false,
      error: { kind: 'list-not-found', listId: 99 },
    });
    expect(repo.setDone(42, true)).toStrictEqual({
      ok: false,
      error: { kind: 'task-not-found', taskId: 42 },
    });
    expect(repo.removeList(42)).toStrictEqual({
      ok: false,
      error: { kind: 'list-not-found', listId: 42 },
    });
    expect(valueOf(repo.tasksOf(list.id))).toStrictEqual([]);
  });

  it('fails exactly the next write with the planned failure, changing nothing', () => {
    const repo = createFakeTaskRepository();
    const list = valueOf(repo.addList({ name: 'Home' }));
    const task = valueOf(repo.addTask({ listId: list.id, title: 'Buy milk' }));
    repo.failNextWrite = { kind: 'storage-full' };
    expect(repo.setDone(task.id, true)).toStrictEqual({
      ok: false,
      error: { kind: 'storage-full' },
    });
    expect(valueOf(repo.tasksOf(list.id))[0]?.isDone).toBe(false);
    expect(repo.setDone(task.id, true)).toStrictEqual({ ok: true, value: undefined });
    expect(valueOf(repo.tasksOf(list.id))[0]?.isDone).toBe(true);
  });

  it('removes a list together with its tasks and keeps the tasks of other lists', () => {
    const repo = createFakeTaskRepository();
    const list = valueOf(repo.addList({ name: 'Home' }));
    const other = valueOf(repo.addList({ name: 'Work' }));
    repo.addTask({ listId: list.id, title: 'Buy milk' });
    const kept = valueOf(repo.addTask({ listId: other.id, title: 'File the report' }));
    repo.removeList(list.id);
    expect([valueOf(repo.lists()), valueOf(repo.tasksOf(list.id))]).toStrictEqual([[other], []]);
    expect(valueOf(repo.tasksOf(other.id))).toStrictEqual([kept]);
  });

  it('orders lists that share a name by id, as the adapter does', () => {
    const repo = createFakeTaskRepository();
    const first = valueOf(repo.addList({ name: 'Home' }));
    const second = valueOf(repo.addList({ name: 'Home' }));
    expect(valueOf(repo.lists()).map((list) => list.id)).toStrictEqual([first.id, second.id]);
  });
});
