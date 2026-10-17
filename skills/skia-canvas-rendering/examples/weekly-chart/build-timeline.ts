// src/features/insights/canvas/build-timeline.ts
// Channels: bar (per day) [from → to] the bar's value tweens; flash (per day) [1 → 0] the changed bar
// flashes once (an effect: drawn only while it plays).
import type { WeeklyChartEvent } from './canvas-model';
import type { Motion, Track } from '@/canvas/timeline/track';

export const CHANGE_BUDGET_MS = 900;
const STAGGER_MS = 40;

type Timing = { readonly scale: number; readonly isFull: boolean };

function dayUpdated(
  event: Extract<WeeklyChartEvent, { kind: 'day-updated' }>,
  timing: Timing,
): Track[] {
  const tween = { entityId: event.day, startMs: 0, durationMs: 360 * timing.scale } as const;
  const bar: Track = {
    ...tween,
    channel: 'bar',
    easing: timing.isFull ? 'out-back' : 'linear',
    from: [event.from],
    to: [event.to],
    cue: { sound: 'tick', haptic: 'light' },
  };
  const flash: Track = { ...tween, channel: 'flash', easing: 'out-quad', from: [1], to: [0] };
  return timing.isFull ? [bar, flash] : [bar];
}

function weekStarted(
  event: Extract<WeeklyChartEvent, { kind: 'week-started' }>,
  timing: Timing,
): Track[] {
  return event.previous.map((value, day) => ({
    channel: 'bar',
    entityId: day,
    startMs: day * STAGGER_MS * timing.scale,
    durationMs: 300 * timing.scale,
    easing: 'in-quad',
    from: [value],
    to: [0],
  }));
}

export function buildTimeline(
  events: readonly WeeklyChartEvent[],
  motion: Motion,
): readonly Track[] {
  const timing = { scale: motion === 'full' ? 1 : 0.5, isFull: motion === 'full' };
  return events.flatMap((event) =>
    event.kind === 'day-updated' ? dayUpdated(event, timing) : weekStarted(event, timing),
  );
}
