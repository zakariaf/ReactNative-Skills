// src/canvas/present-change.test.ts
import { presentChange } from './present-change';
import { isSceneAnimating, NOT_STARTED } from './scene';

import type { PresenterDeps } from './present-change';
import type { Scene } from './scene';
import type { Track } from './timeline/track';

const glow: Track = {
  channel: 'glow',
  entityId: 3,
  startMs: 0,
  durationMs: 300,
  easing: 'linear',
  from: [0],
  to: [1],
  cue: { sound: 'complete' },
};

describe('presentChange', () => {
  it('cancels old cues, pushes the final view as scene <seq>, then schedules new cues', () => {
    const pushed: Scene<string>[] = [];
    const log: string[] = [];
    const deps: PresenterDeps<number, string, string> = {
      toView: (state) => `view-${String(state)}`,
      buildTimeline: (events) => events.map(() => glow),
      motion: 'full',
      clock: { push: (scene) => pushed.push(scene) },
      cues: {
        cancel: () => log.push('cancel'),
        schedule: (tracks) => log.push(`cues:${String(tracks.length)}`),
      },
    };
    presentChange(deps, { seq: 1, state: 1, events: ['task-completed'] });
    presentChange(deps, { seq: 2, state: 2, events: ['task-completed'] });
    const summary = pushed.map((scene) => [scene.seq, scene.view, scene.endMs, scene.startAt]);
    expect(summary).toStrictEqual([
      [1, 'view-1', 300, NOT_STARTED],
      [2, 'view-2', 300, NOT_STARTED],
    ]);
    expect(log).toStrictEqual(['cancel', 'cues:1', 'cancel', 'cues:1']);
  });

  it('reports a pushed scene as animating until its end', () => {
    expect(isSceneAnimating({ startAt: NOT_STARTED, endMs: 300 }, 999)).toBe(true);
    expect(isSceneAnimating({ startAt: 1000, endMs: 300 }, 1299)).toBe(true);
    expect(isSceneAnimating({ startAt: 1000, endMs: 300 }, 1300)).toBe(false);
  });
});
