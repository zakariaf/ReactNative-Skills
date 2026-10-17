// src/features/insights/canvas/build-timeline.test.ts
import { timelineEndMs } from '@/canvas/timeline/track';

import { buildTimeline, CHANGE_BUDGET_MS } from './build-timeline';

import type { WeeklyChartEvent } from './canvas-model';

const UPDATED: WeeklyChartEvent = { kind: 'day-updated', day: 2, from: 4, to: 5 };
/** The busiest change: a new week, every bar falls. */
const NEW_WEEK: WeeklyChartEvent = { kind: 'week-started', previous: [3, 0, 5, 2, 4, 1, 6] };

describe('buildTimeline', () => {
  it('keeps the busiest change within the animation budget', () => {
    expect(timelineEndMs(buildTimeline([NEW_WEEK], 'full'))).toBeLessThanOrEqual(CHANGE_BUDGET_MS);
  });

  it('tweens the changed bar from its old value and flashes it once, with a tick', () => {
    const tracks = buildTimeline([UPDATED], 'full');
    expect(tracks.map((track) => track.channel)).toStrictEqual(['bar', 'flash']);
    expect(tracks[0]?.from).toStrictEqual([4]);
    expect(tracks[0]?.cue).toStrictEqual({ sound: 'tick', haptic: 'light' });
  });

  it('drops the flash and the overshoot under reduced motion, and is shorter', () => {
    const tracks = buildTimeline([UPDATED, NEW_WEEK], 'reduced');
    expect(tracks.some((track) => track.channel === 'flash')).toBe(false);
    expect(tracks.some((track) => track.easing === 'out-back')).toBe(false);
    expect(timelineEndMs(tracks)).toBeLessThan(timelineEndMs(buildTimeline([NEW_WEEK], 'full')));
  });

  it('returns the same tracks for the same events', () => {
    expect(buildTimeline([UPDATED], 'full')).toStrictEqual(buildTimeline([UPDATED], 'full'));
  });
});
