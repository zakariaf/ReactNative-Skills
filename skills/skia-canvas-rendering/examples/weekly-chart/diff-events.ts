// src/features/insights/canvas/diff-events.ts
// Server data arrives as whole states, so the events are derived: what changed between the state the
// chart shows and the state the query cache now holds. Pure, so the test pins every case.
import type { WeeklyChartEvent, WeeklyChartState } from './canvas-model';

export function diffEvents(
  previous: WeeklyChartState,
  next: WeeklyChartState,
): readonly WeeklyChartEvent[] {
  if (next.weekOf !== previous.weekOf) return [{ kind: 'week-started', previous: previous.done }];
  return next.done.flatMap((to, day): WeeklyChartEvent[] => {
    const from = previous.done[day] ?? 0;
    return from === to ? [] : [{ kind: 'day-updated', day, from, to }];
  });
}
