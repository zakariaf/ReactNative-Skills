// src/data/tasks/fake-task-store.test.ts
import { createFakeTaskStore } from './fake-task-store';

import type { Task } from './task-store-port';

describe('createFakeTaskStore', () => {
  it('calls a watcher at once and after every write to its list, and stops after unsubscribe', () => {
    const store = createFakeTaskStore();
    const seen: (readonly Task[])[] = [];
    const unsubscribe = store.watchList('inbox', {
      onTasks: (tasks) => seen.push(tasks),
      onError: jest.fn(),
    });

    const added = store.addTask({ listId: 'inbox', title: ' Buy milk ' });
    unsubscribe();
    store.addTask({ listId: 'inbox', title: 'Call Sam' });

    expect(added).toStrictEqual({ ok: true, value: { id: 'task-1' } });
    expect(seen.map((tasks) => tasks.map((task) => task.title))).toStrictEqual([[], ['Buy milk']]);
    expect(store.watcherCount()).toBe(0);
  });

  it('refuses an empty title and records a planned server rejection', () => {
    const store = createFakeTaskStore();
    store.rejectNextWrite('permission-denied');

    expect(store.addTask({ listId: 'inbox', title: '   ' })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-task', field: 'title' },
    });
    store.addTask({ listId: 'inbox', title: 'Buy milk' });

    expect(store.rejections()).toStrictEqual([
      { kind: 'write-rejected', taskId: 'task-1', code: 'permission-denied' },
    ]);
  });
});
