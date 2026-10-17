// src/features/tasks/use-tasks-model.ts (example: the Tasks model hook moved onto server state)
// The only code of the feature that reads services, server state, copy and navigation. It composes the
// query and mutation factories of src/api/tasks/ and hands the screen plain values and void intents;
// the screen and its props stay what they were when the tasks lived in memory.
// `subscribed: isFocused` stops a stacked screen that is out of sight from re-rendering and from
// refetching on focus or reconnect; it catches up when it is shown again.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { taskMutations } from '@/api/tasks/task-mutations';
import { taskQueries } from '@/api/tasks/task-queries';
import { useLanguage } from '@/i18n/language-context';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { countOpen, sortTasks } from './task-list';
import { taskListStateOf } from './task-list-state';

import type { Task } from './task-list';
import type { TaskListState } from './task-list-state';
import type { ApiTask } from '@/api/tasks/task-schemas';

/** What the Tasks screen renders. */
export type TasksModel = {
  /** Translated: "2 open tasks". */
  readonly summary: string;
  /** Open tasks first, then done ones; empty until the first answer. */
  readonly tasks: readonly Task[];
  /** Flips a task between open and done (optimistic: the list changes at once). */
  readonly onToggle: (id: string) => void;
  readonly isReducedMotion: boolean;
  /** Loading, offline, failed or ready, for the screen's non-happy paths (ui-states-and-feedback). */
  readonly listState: TaskListState;
  /** Asks again after a failure (pull to refresh, the retry button). */
  readonly onRetry: () => void;
};

function toTask(task: ApiTask): Task {
  return { id: task.id, title: task.title, isDone: task.isDone };
}

export function useTasksModel(): TasksModel {
  const t = useT();
  const language = useLanguage();
  const isReducedMotion = useReduceMotion();
  const { api, errorLog } = useServices();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const query = useQuery({
    ...taskQueries.list(api, 'all'),
    select: (items) => items.map(toTask),
    subscribed: isFocused,
  });
  const toggle = useMutation(taskMutations.toggle(api, queryClient));
  const tasks = sortTasks(query.data ?? [], language);
  return {
    summary: t('tasks.summary.open', { openCount: countOpen(tasks) }),
    tasks,
    onToggle: (id) => {
      const task = tasks.find((candidate) => candidate.id === id);
      if (task !== undefined) toggle.mutate({ id, isDone: !task.isDone });
    },
    isReducedMotion,
    listState: taskListStateOf(query),
    onRetry: () => {
      query.refetch().catch((error: unknown) => {
        errorLog.record('network', error);
      });
    },
  };
}
