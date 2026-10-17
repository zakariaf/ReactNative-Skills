// src/stores/update-and-publish.test.ts
import { err } from '@/core/result';
import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { createStores } from '@/stores/create-stores';
import { updateAndPublish } from '@/stores/update-and-publish';

import type { FakeTaskRepository } from '@/data/tasks/fake-task-repository';

/** Two lists; list 1 holds two tasks, list 2 holds one. */
function seededRepository(): FakeTaskRepository {
  const tasks = createFakeTaskRepository();
  for (const name of ['Groceries', 'Work']) expect(tasks.addList({ name }).ok).toBe(true);
  for (const [listId, title] of [
    [1, 'Buy milk'],
    [1, 'Buy bread'],
    [2, 'Answer mail'],
  ] as const) {
    expect(tasks.addTask({ listId, title }).ok).toBe(true);
  }
  return tasks;
}

describe('updateAndPublish', () => {
  it('writes once, then every store shows what is on disk', () => {
    const tasks = seededRepository();
    const stores = createStores({ tasks });
    const removeList = jest.spyOn(tasks, 'removeList');
    const result = updateAndPublish(stores, () => tasks.removeList(1));
    expect(result.ok).toBe(true);
    expect(removeList).toHaveBeenCalledTimes(1);
    expect(stores.lists.getState().lists.map((list) => list.name)).toStrictEqual(['Work']);
    expect(stores.tasks.getState().tasks.map((task) => task.title)).toStrictEqual(['Answer mail']);
  });

  it('publishes nothing when the write fails', () => {
    const tasks = seededRepository();
    const stores = createStores({ tasks });
    const listener = jest.fn();
    stores.lists.subscribe(listener);
    stores.tasks.subscribe(listener);
    tasks.failNextWrite = { kind: 'storage-full' };
    expect(updateAndPublish(stores, () => tasks.removeList(1))).toStrictEqual(
      err({ kind: 'storage-full' }),
    );
    expect(listener).not.toHaveBeenCalled();
    expect(stores.tasks.getState().tasks).toHaveLength(3);
  });
});
