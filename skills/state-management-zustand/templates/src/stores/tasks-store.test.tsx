// src/stores/tasks-store.test.tsx
import { renderHook } from '@testing-library/react-native';
import { useShallow } from 'zustand/shallow';

import { err, ok } from '@/core/result';
import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { createStores } from '@/stores/create-stores';
import { StoresProvider } from '@/stores/stores-context';
import { selectOpenTaskCount, selectTasksOfList } from '@/stores/tasks-selectors';
import { createTasksStore, useTasksStore } from '@/stores/tasks-store';

import type { FakeTaskRepository } from '@/data/tasks/fake-task-repository';
import type { Stores } from '@/stores/stores-context';
import type { ReactNode } from 'react';

/** A repository holding one list ("Groceries", id 1) with one open task ("Buy milk", id 2). */
function seededRepository(): FakeTaskRepository {
  const tasks = createFakeTaskRepository();
  expect(tasks.addList({ name: 'Groceries' }).ok).toBe(true);
  expect(tasks.addTask({ listId: 1, title: 'Buy milk' }).ok).toBe(true);
  return tasks;
}

function isDoneOnDisk(tasks: FakeTaskRepository, taskId: number): boolean | null {
  const onDisk = tasks.tasksOf(1);
  return onDisk.ok ? (onDisk.value.find((task) => task.id === taskId)?.isDone ?? null) : null;
}

function wrapperOf(stores: Stores): (props: { readonly children: ReactNode }) => ReactNode {
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <StoresProvider stores={stores}>{children}</StoresProvider>;
  }
  return Wrapper;
}

describe('tasks store', () => {
  it('saves a change before it publishes it', () => {
    const tasks = seededRepository();
    const store = createTasksStore({ tasks });
    const seenOnDisk: (boolean | null)[] = [];
    store.subscribe(() => {
      seenOnDisk.push(isDoneOnDisk(tasks, 2));
    });
    expect(store.getState().setDone(2, true)).toStrictEqual(ok(undefined));
    expect(seenOnDisk).toStrictEqual([true]);
  });

  it('writes nothing and renders nothing for a change that changes nothing', () => {
    const tasks = seededRepository();
    const setDone = jest.spyOn(tasks, 'setDone');
    const store = createTasksStore({ tasks });
    const listener = jest.fn();
    store.subscribe(listener);
    expect(store.getState().setDone(2, false)).toStrictEqual(ok(undefined));
    expect(setDone).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('publishes nothing when the write fails', () => {
    const tasks = seededRepository();
    const store = createTasksStore({ tasks });
    tasks.failNextWrite = { kind: 'storage-busy' };
    expect(store.getState().setDone(2, true)).toStrictEqual(err({ kind: 'storage-busy' }));
    expect(store.getState().tasks[0]?.isDone).toBe(false);
    expect(store.getState().addTask(1, '   ')).toStrictEqual(
      err({ kind: 'task-input-invalid', field: 'title' }),
    );
    expect(store.getState().tasks).toHaveLength(1);
  });

  it('shows a saved task with the id the repository gave it', () => {
    const store = createTasksStore({ tasks: seededRepository() });
    const added = store.getState().addTask(1, 'Buy bread');
    expect(added.ok && added.value.id).toBe(3);
    expect(store.getState().tasks.map((task) => task.title)).toStrictEqual([
      'Buy milk',
      'Buy bread',
    ]);
  });

  it('reads a built array through useShallow without re-render loops', async () => {
    const stores = createStores({ tasks: seededRepository() });
    const { result } = await renderHook(
      () => ({
        count: useTasksStore(selectOpenTaskCount),
        ofList: useTasksStore(useShallow((state) => selectTasksOfList(state, 1))),
      }),
      { wrapper: wrapperOf(stores) },
    );
    expect(result.current.count).toBe(1);
    expect(result.current.ofList.map((task) => task.title)).toStrictEqual(['Buy milk']);
  });

  it('loops when a built array is selected without useShallow (the Zustand 5 trap)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const stores = createStores({ tasks: seededRepository() });
    await expect(
      renderHook(() => useTasksStore((state) => selectTasksOfList(state, 1)), {
        wrapper: wrapperOf(stores),
      }),
    ).rejects.toThrow('Maximum update depth exceeded');
  });
});
