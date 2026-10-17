// src/features/tasks/urgency-labels.ts: a constants table, covered by the tests that use it.
export const URGENCY_KEYS = ['tasks.urgency.overdue', 'tasks.urgency.today'] as const;
export type UrgencyKey = (typeof URGENCY_KEYS)[number];
