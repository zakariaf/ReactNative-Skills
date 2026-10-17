// src/canvas/use-surface-player.ts
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { EMPTY_LAYOUT } from './canvas-layout';
import { createCueScheduler } from './cue-scheduler';
import { presentChange } from './present-change';
import { makeScene } from './scene';
import { useCanvasLifecycle } from './use-canvas-lifecycle';
import { useSceneClock } from './use-scene-clock';

import type { CanvasLayout } from './canvas-layout';
import type { CanvasSurface, ViewFormat } from './canvas-types';
import type { CueAudio, CueHaptics, CueScheduler } from './cue-scheduler';
import type { CommittedChange } from './present-change';
import type { Scene } from './scene';
import type { ClockTraceLabel } from './scene-clock-state';
import type { Motion, Track } from './timeline/track';
import type { RunnableFlags } from './use-canvas-lifecycle';
import type { ClockTraceSample, ClockTraceSink, SceneClock } from './use-scene-clock';
import type { SkSize } from '@shopify/react-native-skia';
import type { RefObject } from 'react';
import type { DerivedValue, SharedValue } from 'react-native-reanimated';

/** The audio the player needs: the cue methods plus the session pause (an AudioPort fits). */
export type SurfaceAudio = CueAudio & {
  readonly suspend: () => Promise<void>;
  readonly resume: () => Promise<void>;
};

/** One clock trace entry (debug builds): the clock's numbers and the lifecycle facts. */
export type ClockTraceData = ClockTraceSample & RunnableFlags;
export type ClockTrace = (label: ClockTraceLabel, data: ClockTraceData) => void;

export type SurfacePlayerInput<TState, TEvent, TView, TToken extends string> = {
  readonly surface: CanvasSurface<TState, TView, TToken>;
  readonly buildTimeline: (events: readonly TEvent[], motion: Motion) => readonly Track[];
  /**
   * The latest committed change (already persisted): from the store, or from useCommittedChange for
   * server data. The change present at mount is shown without animation; later seqs animate.
   */
  readonly change: CommittedChange<TState, TEvent>;
  readonly format: ViewFormat;
  /** 'reduced' when the app's Reduce motion setting is on (it defaults to the OS setting). */
  readonly motion: Motion;
  /** The layout direction (rtl-and-direction's useDirection() === 'rtl'), never the language's. */
  readonly isRtl: boolean;
  readonly isFocused: boolean;
  readonly isInterrupted: boolean;
  /** Report a draw or frame error (to the error log); it never crashes the app. */
  readonly onFailure: (message: string) => void;
  /** `(error) => errorLog.record('audio', error)` for non-fatal audio session failures. */
  readonly reportError: (error: unknown) => void;
  /** Leave out for a silent surface. */
  readonly audio?: SurfaceAudio;
  readonly haptics?: CueHaptics;
  /** Debug builds only: where clock events go. */
  readonly traceClock?: ClockTrace;
  /** A frame-time recorder (a worklet), fed from the clock's frame callback. */
  readonly onFrameTime?: (dtMs: number | null) => void;
};

export type SurfacePlayer<TView> = {
  readonly clock: SceneClock<TView>;
  readonly size: SharedValue<SkSize>;
  readonly layout: DerivedValue<CanvasLayout>;
};

const SILENT_AUDIO: SurfaceAudio = {
  play: () => undefined,
  cancelPending: () => undefined,
  suspend: () => Promise.resolve(),
  resume: () => Promise.resolve(),
};
const NO_HAPTICS: CueHaptics = { play: () => undefined };
const NO_FLAGS: RunnableFlags = { isAppActive: false, isFocused: false, isInterrupted: false };

/** The canvas size (written by <Canvas onSize>) and the layout of the scene's view at that size. */
function useSurfaceLayout<TView>(
  layoutOf: CanvasSurface<unknown, TView, string>['layout'],
  scene: SharedValue<Scene<TView>>,
  isMirrored: boolean,
): Pick<SurfacePlayer<TView>, 'size' | 'layout'> {
  const size = useSharedValue<SkSize>({ width: 0, height: 0 });
  const layout = useDerivedValue(() => {
    const { width, height } = size.get();
    return width === 0
      ? EMPTY_LAYOUT
      : layoutOf({ width, height, view: scene.get().view, isMirrored });
  });
  return { size, layout };
}

type TraceSink = {
  readonly flagsRef: RefObject<RunnableFlags>;
  readonly sink: ClockTraceSink | null;
};

/** Debug builds: every clock trace entry carries the lifecycle facts last reported. */
function useTraceSink(traceClock: ClockTrace | undefined): TraceSink {
  const flagsRef = useRef(NO_FLAGS);
  const sink =
    traceClock === undefined
      ? null
      : (label: ClockTraceLabel, sample: ClockTraceSample): void => {
          traceClock(label, { ...sample, ...flagsRef.current });
        };
  return { flagsRef, sink };
}

type LifecycleParts<TView> = {
  readonly clock: SceneClock<TView>;
  readonly cues: CueScheduler;
  readonly audio: SurfaceAudio;
  readonly flagsRef: RefObject<RunnableFlags>;
};
type LifecycleFacts = Pick<
  SurfacePlayerInput<unknown, unknown, unknown, string>,
  'isFocused' | 'isInterrupted' | 'reportError'
>;

/** Stops the clock, the cues and the audio session whenever the surface may not run. */
function useSurfaceLifecycle<TView>(parts: LifecycleParts<TView>, facts: LifecycleFacts): void {
  const { clock, cues, audio, flagsRef } = parts;
  useCanvasLifecycle({
    isFocused: facts.isFocused,
    isInterrupted: facts.isInterrupted,
    onPause: () => {
      clock.stop();
      cues.cancel();
      audio.suspend().catch(facts.reportError);
    },
    onResume: () => {
      audio.resume().catch(facts.reportError);
      clock.resume();
    },
    onFlags: (next) => {
      flagsRef.current = next;
      clock.trace('runnable');
    },
  });
}

/**
 * Clock + presenter + cues + lifecycle for one surface. A display-only screen renders SurfaceHost;
 * an interactive one calls this hook, builds its gestures from `layout`, and renders SurfaceCanvas.
 */
export function useSurfacePlayer<TState, TEvent, TView, TToken extends string>(
  input: SurfacePlayerInput<TState, TEvent, TView, TToken>,
): SurfacePlayer<TView> {
  const { surface, change, format } = input;
  const audio = input.audio ?? SILENT_AUDIO;
  const toView = (state: TState): TView => surface.toView(state, format);
  const { flagsRef, sink } = useTraceSink(input.traceClock);
  const clock = useSceneClock(makeScene(change.seq, toView(change.state), []), input.onFailure, {
    trace: sink,
    onFrameTime: input.onFrameTime ?? null,
  });
  const [cues] = useState(() => createCueScheduler(audio, input.haptics ?? NO_HAPTICS));
  // The clock starts on the mounted change's final view. Only a change committed while the surface
  // is mounted animates: a screen pushed again would otherwise replay the store's last change (its
  // flips, bursts, sounds and haptics) every time it opens.
  const shownSeqRef = useRef(change.seq);
  const present = useEffectEvent((next: CommittedChange<TState, TEvent>) => {
    if (next.seq === shownSeqRef.current) return;
    shownSeqRef.current = next.seq;
    const deps = { toView, buildTimeline: input.buildTimeline, motion: input.motion, clock, cues };
    presentChange(deps, next);
  });
  useEffect(() => {
    present(change);
  }, [change]);
  useSurfaceLifecycle({ clock, cues, audio, flagsRef }, input);
  const isMirrored = input.isRtl && surface.isMirroredInRtl;
  return { clock, ...useSurfaceLayout(surface.layout, clock.scene, isMirrored) };
}
