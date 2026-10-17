// src/features/tasks/use-tasks-model.ts (a shape to imitate, not a template)
// The model hook is the one place a feature reads ports, stores and navigation. The screen
// (tasks-screen.tsx) receives its result as plain values and callbacks; the pure rules come from
// src/core and the feature's own logic file, so they are tested without React. Store shapes
// (useTasksStore, the selectors, Result-returning actions) are state-management-zustand's.
import { router } from 'expo-router';
import { useState } from 'react';
import { useShallow } from 'zustand/shallow';

import { useServices } from '@/services/services-context';
import { selectSetDone, selectTasksOfList } from '@/stores/tasks-selectors';
import { useTasksStore } from '@/stores/tasks-store';

import { isRecent } from './task-order';

import type { Task, TaskFailure } from '@/data/tasks/task-repository';

export type TasksModel = {
  /** Added in the last 24 hours. */
  readonly recent: readonly Task[];
  readonly older: readonly Task[];
  /** The last change that did not reach the disk (the screen explains it), or null. */
  readonly failure: TaskFailure | null;
  readonly onOpenTask: (taskId: number) => void;
  readonly onToggle: (taskId: number, isDone: boolean) => void;
};

export function useTasksModel(listId: number): TasksModel {
  // A port from the composition root: time arrives as a value the pure rule receives.
  const { clock } = useServices();
  // A built array goes through useShallow; a function reference does not need it.
  const tasks = useTasksStore(useShallow((state) => selectTasksOfList(state, listId)));
  const setDone = useTasksStore(selectSetDone);
  const [failure, setFailure] = useState<TaskFailure | null>(null);
  // Read the time once, when the screen mounts (a state initializer), never in the render body: the
  // React Compiler may memoize a render-time read on the stable clock, so the split would go stale
  // anyway. A screen that must re-split while open takes nowMs from a ticking state instead.
  const [nowMs] = useState(() => clock.nowMs());
  return {
    recent: tasks.filter((task) => isRecent(task, nowMs)),
    older: tasks.filter((task) => !isRecent(task, nowMs)),
    failure,
    onOpenTask: (taskId) => {
      router.push(`/tasks/${taskId}`);
    },
    onToggle: (taskId, isDone) => {
      // Expected failures come back as values; the data layer already logged an unexpected one.
      const result = setDone(taskId, isDone);
      setFailure(result.ok ? null : result.error);
    },
  };
}
