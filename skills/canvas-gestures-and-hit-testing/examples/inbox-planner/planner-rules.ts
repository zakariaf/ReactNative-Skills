// src/features/planner/planner-rules.ts
// The planner's domain: unscheduled tasks wait in the inbox; scheduling one puts it on a day. The
// one source of truth for what may be scheduled where is listScheduleActions.

export type PlannerState = {
  /** Weeks shown, 7 days each (row-major: day = week * 7 + weekday). */
  readonly weeks: number;
  /** Tasks already on each day. */
  readonly dayLoads: readonly number[];
  /** Days before this index are in the past and take no new tasks. */
  readonly todayIndex: number;
  /** The inbox slots: an unscheduled task id, or null for an empty slot. */
  readonly inbox: readonly (string | null)[];
  readonly maxPerDay: number;
};

export type PlannerAction = {
  readonly kind: 'schedule-task';
  readonly taskId: string;
  readonly day: number;
};

/** Every inbox task × every day from today on that still has room. */
export function listScheduleActions(state: PlannerState): readonly PlannerAction[] {
  const days = state.dayLoads
    .map((load, day) => ({ load, day }))
    .filter(({ load, day }) => day >= state.todayIndex && load < state.maxPerDay);
  return state.inbox.flatMap((taskId) =>
    taskId === null ? [] : days.map(({ day }) => ({ kind: 'schedule-task' as const, taskId, day })),
  );
}
