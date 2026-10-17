// src/features/__FEATURE__/canvas/build-timeline.test.ts
import { timelineEndMs } from '@/canvas/timeline/track';

import { buildTimeline, CHANGE_BUDGET_MS } from './build-timeline';
import { cellEntity } from './canvas-ids';

import type { __SURFACE_PASCAL__Event } from './canvas-model';

/** The busiest change: completing the last week's tasks finishes the grid. */
const BUSIEST: readonly __SURFACE_PASCAL__Event[] = [
  { kind: 'cells-toggled', cells: [27, 21, 22, 23, 24, 25, 26] },
  { kind: 'goal-reached' },
];
const STREAK: __SURFACE_PASCAL__Event = { kind: 'streak-extended', days: 12 };

describe('buildTimeline', () => {
  it('keeps the busiest change within the animation budget', () => {
    expect(timelineEndMs(buildTimeline(BUSIEST, 'full'))).toBeLessThanOrEqual(CHANGE_BUDGET_MS);
  });

  it('turns every toggled day over, the one the user acted on first', () => {
    const flips = buildTimeline(BUSIEST, 'full').filter((track) => track.channel === 'flip');
    expect(flips.map((track) => track.entityId)).toStrictEqual(
      [27, 21, 22, 23, 24, 25, 26].map(cellEntity),
    );
    expect(flips[0]?.startMs).toBeLessThan(flips[1]?.startMs ?? 0);
  });

  it('drops particles and overshoot under reduced motion, and is shorter', () => {
    const tracks = buildTimeline([...BUSIEST, STREAK], 'reduced');
    expect(tracks.some((track) => track.channel === 'burst')).toBe(false);
    expect(tracks.some((track) => track.easing === 'out-back')).toBe(false);
    expect(timelineEndMs(tracks)).toBeLessThan(timelineEndMs(buildTimeline(BUSIEST, 'full')));
  });

  it('cues each beat with its sound and haptic', () => {
    const cues = buildTimeline([...BUSIEST, STREAK], 'full')
      .map((track) => track.cue)
      .filter((cue) => cue !== undefined);
    expect(cues).toStrictEqual([
      { sound: 'complete', haptic: 'light' },
      { sound: 'goal', haptic: 'success' },
      { sound: 'streak', haptic: 'medium' },
    ]);
  });

  it('returns the same tracks for the same events', () => {
    expect(buildTimeline(BUSIEST, 'full')).toStrictEqual(buildTimeline(BUSIEST, 'full'));
  });
});
