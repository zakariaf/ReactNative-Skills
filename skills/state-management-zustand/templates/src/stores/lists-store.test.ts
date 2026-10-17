// src/stores/lists-store.test.ts
import { err } from '@/core/result';
import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { createListsStore } from '@/stores/lists-store';

import type { FakeTaskRepository } from '@/data/tasks/fake-task-repository';

function namesOnDisk(tasks: FakeTaskRepository): readonly string[] {
  const lists = tasks.lists();
  return lists.ok ? lists.value.map((list) => list.name) : [];
}

describe('lists store', () => {
  it('hydrates from the repository when it is created', () => {
    const tasks = createFakeTaskRepository();
    expect(tasks.addList({ name: 'Groceries' }).ok).toBe(true);
    const store = createListsStore({ tasks });
    expect(store.getState().lists.map((list) => list.name)).toStrictEqual(['Groceries']);
    expect(store.getState().loadFailure).toBeNull();
  });

  it('saves a new list before it publishes it', () => {
    const tasks = createFakeTaskRepository();
    const store = createListsStore({ tasks });
    const seenOnDisk: (readonly string[])[] = [];
    store.subscribe(() => {
      seenOnDisk.push(namesOnDisk(tasks));
    });
    const added = store.getState().addList('Groceries');
    expect(added.ok).toBe(true);
    expect(seenOnDisk).toStrictEqual([['Groceries']]);
  });

  it('publishes nothing when the write fails', () => {
    const tasks = createFakeTaskRepository();
    const store = createListsStore({ tasks });
    const listener = jest.fn();
    store.subscribe(listener);
    tasks.failNextWrite = { kind: 'storage-full' };
    expect(store.getState().addList('Groceries')).toStrictEqual(err({ kind: 'storage-full' }));
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState().lists).toStrictEqual([]);
  });

  it('shows a failed read as a failure, and recovers on reload', () => {
    const tasks = createFakeTaskRepository();
    let isBusy = true;
    const store = createListsStore({
      tasks: { ...tasks, lists: () => (isBusy ? err({ kind: 'storage-busy' }) : tasks.lists()) },
    });
    expect(store.getState().loadFailure).toStrictEqual({ kind: 'storage-busy' });
    isBusy = false;
    expect(tasks.addList({ name: 'Work' }).ok).toBe(true);
    store.getState().reload();
    expect(store.getState().loadFailure).toBeNull();
    expect(store.getState().lists.map((list) => list.name)).toStrictEqual(['Work']);
  });
});
