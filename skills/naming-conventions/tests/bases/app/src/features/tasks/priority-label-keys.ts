// src/features/tasks/priority-label-keys.ts: message keys as a typed table of literals (never built).
import type { TaskPriority } from './task-list';

export const PRIORITY_LABEL_KEYS = {
  low: 'tasks.priority.low',
  normal: 'tasks.priority.normal',
  high: 'tasks.priority.high',
} as const satisfies Readonly<Record<TaskPriority, string>>;
