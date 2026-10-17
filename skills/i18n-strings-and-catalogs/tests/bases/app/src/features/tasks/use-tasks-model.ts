// src/features/tasks/use-tasks-model.ts
import { stripIsolates } from '@/i18n/bidi';
import { formatDayMonth } from '@/i18n/format-date';
import { useT } from '@/i18n/t-context';

import type { MessageKey } from '@/i18n/messages';

const PAGE_KEYS = ['tasks.page', 'tasks.list.title'] as const satisfies readonly MessageKey[];

export type TasksModel = {
  readonly summary: string;
  readonly reminder: string;
  readonly heading: string;
  readonly toggleLabel: string;
};

export function useTasksModel(openCount: number, isDone: boolean): TasksModel {
  const t = useT();
  return {
    summary: t('tasks.summary.open', { openCount }),
    reminder: t('reminders.next', { dateText: stripIsolates(formatDayMonth('2026-09-26', t)) }),
    heading: t(PAGE_KEYS[1]),
    toggleLabel: t(isDone ? 'common.cancel' : 'common.delete'),
  };
}
