// src/canvas/timeline/sample.test.ts
import { EMPTY_FX, fxEntry, isPlaying, sampleTimeline } from './sample';

import type { Track } from './track';

const hop = (startMs: number, from: number, to: number): Track => ({
  channel: 'row',
  entityId: 7,
  startMs,
  durationMs: 100,
  easing: 'linear',
  from: [from],
  to: [to],
});

describe('sampleTimeline', () => {
  it('samples a change without tracks as EMPTY_FX: draw() shows the final state', () => {
    expect(sampleTimeline([], 0)).toStrictEqual(EMPTY_FX);
    expect(fxEntry(EMPTY_FX, 'row', 7)).toBeUndefined();
  });

  it('holds the first hop start value before anything begins', () => {
    const fx = sampleTimeline([hop(200, 3, 4), hop(100, 2, 3)], 50);
    expect(fxEntry(fx, 'row', 7)?.values).toStrictEqual([2]);
  });

  it('follows the latest hop that has started (chains of tweens on one entity)', () => {
    const fx = sampleTimeline([hop(0, 1, 2), hop(100, 2, 3)], 150);
    expect(fxEntry(fx, 'row', 7)?.values).toStrictEqual([2.5]);
  });

  it('ends exactly on the target values', () => {
    const fx = sampleTimeline([hop(0, 1, 2)], 10_000);
    expect(fxEntry(fx, 'row', 7)).toStrictEqual({ values: [2], progress: 1, ageMs: 100 });
  });
});

describe('isPlaying', () => {
  it('is false before the track starts, true while it plays and false once it ended', () => {
    const tracks = [hop(100, 0, 1)];
    expect(isPlaying(fxEntry(sampleTimeline(tracks, 0), 'row', 7))).toBe(false);
    expect(isPlaying(fxEntry(sampleTimeline(tracks, 150), 'row', 7))).toBe(true);
    expect(isPlaying(fxEntry(sampleTimeline(tracks, 200), 'row', 7))).toBe(false);
    expect(isPlaying(undefined)).toBe(false);
  });
});
