// src/canvas/scene.ts
'worklet';

import { timelineEndMs } from './timeline/track';

import type { Track } from './timeline/track';

/** Sentinel written by JS; the first frame after a push replaces it with FrameInfo.timestamp. */
export const NOT_STARTED = -1;

/**
 * Everything the surface needs for one committed change, pushed as ONE shared value, so the UI
 * thread can never pair a new view with old tracks (or the reverse).
 */
export type Scene<TView> = {
  readonly seq: number;
  readonly view: TView;
  readonly tracks: readonly Track[];
  readonly endMs: number;
  readonly startAt: number;
};

export function makeScene<TView>(seq: number, view: TView, tracks: readonly Track[]): Scene<TView> {
  return { seq, view, tracks, endMs: timelineEndMs(tracks), startAt: NOT_STARTED };
}

export type ClockTick = {
  readonly startAt: number;
  readonly elapsedMs: number;
  readonly isDone: boolean;
};

/**
 * Called with FrameInfo.timestamp. Never uses timeSinceFirstFrame: Reanimated resets it to 0 each
 * time a frame callback is re-activated, which froze every animation after the first one in a
 * clock that stored its start on JS (FrameCallbackRegistryUI.ts, verified on Reanimated 4.5.1).
 */
export function tickClock(
  scene: Pick<Scene<unknown>, 'startAt' | 'endMs'>,
  timestamp: number,
): ClockTick {
  const startAt = scene.startAt === NOT_STARTED ? timestamp : scene.startAt;
  const elapsedMs = Math.max(0, timestamp - startAt);
  return { startAt, elapsedMs, isDone: elapsedMs >= scene.endMs };
}

/** Elapsed time for drawing. A just-pushed scene draws its first frame (t = 0). */
export function sceneElapsedMs(
  scene: Pick<Scene<unknown>, 'startAt'>,
  nowTimestamp: number,
): number {
  return scene.startAt === NOT_STARTED ? 0 : Math.max(0, nowTimestamp - scene.startAt);
}

/** JS side: is the last pushed scene still playing? (The 'queue' input policy waits for false.) */
export function isSceneAnimating(
  scene: Pick<Scene<unknown>, 'startAt' | 'endMs'>,
  nowTimestamp: number,
): boolean {
  return sceneElapsedMs(scene, nowTimestamp) < scene.endMs;
}
