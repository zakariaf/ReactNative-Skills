// src/canvas/scene.test.ts
// Drives the frame clock with fake FrameInfo sequences that behave like Reanimated 4.5:
// timeSinceFirstFrame restarts at 0 after every setActive(true), timestamps keep counting.
import { isSceneAnimating, makeScene, NOT_STARTED, sceneElapsedMs, tickClock } from './scene';

import type { Scene } from './scene';
import type { Track } from './timeline/track';
import type { FrameInfo } from 'react-native-reanimated';

const GLOW: Track = {
  channel: 'glow',
  entityId: 1,
  startMs: 0,
  durationMs: 32,
  easing: 'linear',
  from: [0],
  to: [1],
};

type Sample = { readonly elapsedMs: number; readonly isDone: boolean };

/** One activation of the frame callback: timestamps continue, timeSinceFirstFrame restarts. */
function activation(firstTimestamp: number, count: number): FrameInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: firstTimestamp + i * 16,
    timeSinceFirstFrame: i * 16,
    timeSincePreviousFrame: i === 0 ? null : 16,
  }));
}

/** Mirrors runSceneFrame: stamp startAt once, then measure from it. */
function play(scene: Scene<string>, frames: readonly FrameInfo[]): Sample[] {
  let current = scene;
  return frames.map((frame) => {
    const tick = tickClock(current, frame.timestamp);
    current = { ...current, startAt: tick.startAt };
    return { elapsedMs: tick.elapsedMs, isDone: tick.isDone };
  });
}

const EXPECTED: readonly Sample[] = [
  { elapsedMs: 0, isDone: false },
  { elapsedMs: 16, isDone: false },
  { elapsedMs: 32, isDone: true },
];

describe('frame clock', () => {
  it('starts a freshly pushed scene at elapsed 0 on its first frame', () => {
    expect(play(makeScene(1, 'first', [GLOW]), activation(1_000, 3))).toStrictEqual(EXPECTED);
  });

  it('animates the next change from 0 after the frame callback was stopped and restarted', () => {
    play(makeScene(1, 'first', [GLOW]), activation(1_000, 3));
    const restarted = activation(5_000, 3);
    expect(restarted[0]?.timeSinceFirstFrame).toBe(0);
    expect(play(makeScene(2, 'second', [GLOW]), restarted)).toStrictEqual(EXPECTED);
  });

  it('restarts timing when a new scene replaces one that is still animating', () => {
    const replacement = tickClock(makeScene(2, 'second', [GLOW]), 1_016);
    expect(replacement).toStrictEqual({ startAt: 1_016, elapsedMs: 0, isDone: false });
  });

  it('keeps an already stamped scene on its own start time and reports done at the end', () => {
    const stamped = { ...makeScene(1, 'first', [GLOW]), startAt: 1_000 };
    expect(tickClock(stamped, 1_031).isDone).toBe(false);
    expect(tickClock(stamped, 1_040)).toStrictEqual({
      startAt: 1_000,
      elapsedMs: 40,
      isDone: true,
    });
  });

  it('draws a just-pushed scene at t = 0 and reports it animating until its end', () => {
    const pushed = makeScene(3, 'c', [GLOW]);
    expect(pushed.startAt).toBe(NOT_STARTED);
    expect(sceneElapsedMs(pushed, 123_456)).toBe(0);
    expect(isSceneAnimating({ startAt: 1_000, endMs: 32 }, 1_031)).toBe(true);
    expect(isSceneAnimating({ startAt: 1_000, endMs: 32 }, 1_032)).toBe(false);
  });

  it('ends a scene without tracks on its first frame', () => {
    expect(tickClock(makeScene(4, 'idle', []), 7_000).isDone).toBe(true);
  });
});
