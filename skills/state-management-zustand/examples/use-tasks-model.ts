// src/features/tasks/use-tasks-model.ts (a shape to imitate, not a template)
// A feature's model hook: the one place the feature reads stores and calls them. Primitives and
// state references are selected as they are; a built array goes through useShallow; every change
// happens in a handler (never during render); a write that spans stores goes through
// updateAndPublish. The screen receives plain values and callbacks.
import { useState } from 'react';
import { useShallow } from 'zustand/shallow';

import { useAppData } from '@/data/app-data-context';
import { selectAddList, selectListsByName } from '@/stores/lists-selectors';
import { useListsStore } from '@/stores/lists-store';
import { useStores } from '@/stores/stores-context';
import { selectOpenTaskCount, selectSetDone, selectTasksOfList } from '@/stores/tasks-selectors';
import { useTasksStore } from '@/stores/tasks-store';
import { updateAndPublish } from '@/stores/update-and-publish';

import type { Result } from '@/core/result';
import type { Task, TaskFailure, TaskList } from '@/data/tasks/task-repository';

export type TasksModel = {
  readonly lists: readonly TaskList[];
  readonly tasks: readonly Task[];
  readonly openCount: number;
  /** The last change that did not reach the disk (the screen explains it), or null. */
  readonly failure: TaskFailure | null;
  readonly onAddList: (name: string) => void;
  readonly onToggle: (taskId: number, isDone: boolean) => void;
  readonly onRemoveList: (listId: number) => void;
};

export function useTasksModel(listId: number): TasksModel {
  const stores = useStores();
  const data = useAppData();
  // Built arrays: useShallow keeps the same array while its items stay the same.
  const lists = useListsStore(useShallow(selectListsByName));
  const tasks = useTasksStore(useShallow((state) => selectTasksOfList(state, listId)));
  // A number and two function references: no useShallow needed.
  const openCount = useTasksStore(selectOpenTaskCount);
  const addList = useListsStore(selectAddList);
  const setDone = useTasksStore(selectSetDone);
  const [failure, setFailure] = useState<TaskFailure | null>(null);
  const show = (result: Result<unknown, TaskFailure>): void => {
    setFailure(result.ok ? null : result.error);
  };
  return {
    lists,
    tasks,
    openCount,
    failure,
    onAddList: (name) => {
      show(addList(name));
    },
    onToggle: (taskId, isDone) => {
      show(setDone(taskId, isDone));
    },
    onRemoveList: (id) => {
      // The list and its tasks go in one transaction; then both stores re-read the disk.
      show(updateAndPublish(stores, () => data.tasks.removeList(id)));
    },
  };
}
