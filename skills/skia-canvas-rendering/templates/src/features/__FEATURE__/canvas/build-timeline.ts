// src/features/__FEATURE__/canvas/build-timeline.ts
// Pure: the events of one committed change become the short film the surface plays. Channels:
//   flip   (per cell)  [-1 → 1]: the old face turns over (|v| is the height, the sign the face)
//   glow   (change)    [1 → 0]: the whole grid glows when every day is done
//   burst  (change)    particles from the grid centre (full motion only)
//   streak (change)    [0.6 → 1]: the streak label pops when the streak grows
import { CHANGE_ENTITY, cellEntity } from './canvas-ids';

import type { __SURFACE_PASCAL__Event } from './canvas-model';
import type { Motion, Track } from '@/canvas/timeline/track';

/** The longest a change may animate; build-timeline.test.ts enforces it. */
export const CHANGE_BUDGET_MS = 1200;
/** Beat start times (full motion): the day the user acted on turns first, the others after. */
const FOLLOW_DELAY_MS = 50;
const GOAL_AT_MS = 320;

/** Reduced motion: half durations, no particles, no overshoot. */
type Timing = { readonly scale: number; readonly isFull: boolean };

type EventOf<TKind extends __SURFACE_PASCAL__Event['kind']> = Extract<__SURFACE_PASCAL__Event, { kind: TKind }>;

/** Each toggled day turns over; the first carries the sound and the haptic. */
function toggled(event: EventOf<'cells-toggled'>, timing: Timing): Track[] {
  return event.cells.map((index, order) => ({
    channel: 'flip',
    entityId: cellEntity(index),
    startMs: (order === 0 ? 0 : FOLLOW_DELAY_MS) * timing.scale,
    durationMs: 200 * timing.scale,
    easing: 'in-out-quad',
    from: [-1],
    to: [1],
    ...(order === 0 ? { cue: { sound: 'complete', haptic: 'light' as const } } : {}),
  }));
}

/** Every day is done: a glow over the whole grid, plus a particle burst in full motion. */
function goalReached(timing: Timing): Track[] {
  const at = { entityId: CHANGE_ENTITY, startMs: GOAL_AT_MS * timing.scale } as const;
  const glow: Track = {
    ...at,
    channel: 'glow',
    durationMs: 400 * timing.scale,
    easing: 'out-quad',
    from: [1],
    to: [0],
    cue: { sound: 'goal', haptic: 'success' },
  };
  const burst: Track = {
    ...at,
    channel: 'burst',
    durationMs: 700,
    easing: 'linear',
    from: [0],
    to: [1],
  };
  return timing.isFull ? [glow, burst] : [glow];
}

/** The streak grew: its label pops in the middle of the grid. */
function streakExtended(timing: Timing): Track[] {
  return [
    {
      channel: 'streak',
      entityId: CHANGE_ENTITY,
      startMs: 0,
      durationMs: 600 * timing.scale,
      easing: timing.isFull ? 'out-back' : 'linear',
      from: [0.6],
      to: [1],
      cue: { sound: 'streak', haptic: 'medium' },
    },
  ];
}

function tracksFor(event: __SURFACE_PASCAL__Event, timing: Timing): Track[] {
  switch (event.kind) {
    case 'cells-toggled':
      return toggled(event, timing);
    case 'goal-reached':
      return goalReached(timing);
    case 'streak-extended':
      return streakExtended(timing);
  }
}

/** Pure: events → tracks. The same events always give the same tracks. */
export function buildTimeline(
  events: readonly __SURFACE_PASCAL__Event[],
  motion: Motion,
): readonly Track[] {
  const timing = { scale: motion === 'full' ? 1 : 0.5, isFull: motion === 'full' };
  return events.flatMap((event) => tracksFor(event, timing));
}
