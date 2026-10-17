// src/canvas/present-change.ts
import { makeScene } from './scene';

import type { CueScheduler } from './cue-scheduler';
import type { Motion, Track } from './timeline/track';
import type { SceneClock } from './use-scene-clock';

export type PresenterDeps<TState, TEvent, TView> = {
  /** surface.toView with the app's ViewFormat already applied. */
  readonly toView: (state: TState) => TView;
  /** The surface's buildTimeline. */
  readonly buildTimeline: (events: readonly TEvent[], motion: Motion) => readonly Track[];
  /** 'reduced' when the app's Reduce motion setting is on (it defaults to the OS setting). */
  readonly motion: Motion;
  readonly clock: Pick<SceneClock<TView>, 'push'>;
  readonly cues: CueScheduler;
};

/** What the store publishes after it applied AND persisted a change. */
export type CommittedChange<TState, TEvent> = {
  /** A counter from the store, one per committed change: becomes the scene's seq. */
  readonly seq: number;
  readonly state: TState;
  /** Past-tense events carrying every id and from/to value the animation needs. */
  readonly events: readonly TEvent[];
};

/**
 * Shows one committed change. The view is always the final state, so a new change simply replaces
 * a running animation (fast-forward); the old change's unfired cues are cancelled first.
 */
export function presentChange<TState, TEvent, TView>(
  deps: PresenterDeps<TState, TEvent, TView>,
  change: CommittedChange<TState, TEvent>,
): void {
  deps.cues.cancel();
  const tracks = deps.buildTimeline(change.events, deps.motion);
  deps.clock.push(makeScene(change.seq, deps.toView(change.state), tracks));
  deps.cues.schedule(tracks);
}
