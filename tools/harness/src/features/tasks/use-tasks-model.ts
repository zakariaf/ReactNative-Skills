// src/features/tasks/use-tasks-model.ts: the only code of the feature that reads state, copy and
// settings; the screen receives what it returns.
import { useState } from 'react';

import { useLanguage } from '@/i18n/language-context';
import { useT } from '@/i18n/t-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { countOpen, sortTasks, toggleTask } from './task-list';

import type { Task } from './task-list';

/** The tasks a fresh install shows (sample data; the data layer's repository replaces it). */
export const SAMPLE_TASKS: readonly Task[] = [
  { id: 'task-1', title: 'Water the plants', isDone: true },
  { id: 'task-2', title: 'Buy milk', isDone: false },
  { id: 'task-3', title: 'Answer email', isDone: false },
];

/** What the Tasks screen renders. */
export type TasksModel = {
  /** Translated: "2 open tasks". */
  readonly summary: string;
  /** Open tasks first, then done ones, each group in the UI language's title order. */
  readonly tasks: readonly Task[];
  readonly onToggle: (id: string) => void;
  readonly isReducedMotion: boolean;
};

export function useTasksModel(): TasksModel {
  const t = useT();
  const language = useLanguage();
  const isReducedMotion = useReduceMotion();
  const [tasks, setTasks] = useState(SAMPLE_TASKS);
  return {
    summary: t('tasks.summary.open', { openCount: countOpen(tasks) }),
    tasks: sortTasks(tasks, language),
    onToggle: (id) => {
      setTasks((current) => toggleTask(current, id));
    },
    isReducedMotion,
  };
}
