// src/canvas/run-scene-frame.ts
'worklet';

import { scheduleOnRN } from 'react-native-worklets';

import { describeError } from './describe-error';
import { NOT_STARTED, tickClock } from './scene';
import { traceFrameStep } from './scene-clock-state';

import type { Scene } from './scene';
import type { TraceWindow } from './scene-clock-state';
import type { SharedValue } from 'react-native-reanimated';

/** One traced frame as the UI thread saw it (the JS side adds the lifecycle flags). */
export type ClockSample = {
  readonly run: number;
  readonly seq: number;
  readonly startAt: number;
  readonly elapsedMs: number;
  readonly endMs: number;
};

/** Debug builds with a trace sink: the UI thread's window and the JS sink of sampled frames. */
export type SceneFrameTrace = {
  readonly window: SharedValue<TraceWindow>;
  readonly onFrame: (sample: ClockSample) => void;
};

/**
 * What the frame runner reads and writes. The whole frame-callback body is one call into
 * runSceneFrame: one worklet call per frame, try/catch in one place, and React Compiler still
 * memoises the hook (it bails out on value blocks such as ?. or ternaries inside try/catch).
 */
export type SceneFrameWiring<TView> = {
  readonly scene: SharedValue<Scene<TView>>;
  readonly now: SharedValue<number>;
  /** The JS side's current run (scene-clock-state), written before every setActive(true). */
  readonly run: SharedValue<number>;
  /** The scene has ended: JS stops the clock only if `run` is still its current run. */
  readonly onDone: (run: number, seq: number) => void;
  readonly onError: (message: string) => void;
  /** Debug builds with a trace sink; null otherwise. */
  readonly trace: SceneFrameTrace | null;
  /** A frame-time recorder (a worklet that samples dtMs while recording); null otherwise. */
  readonly onFrameTime: ((dtMs: number | null) => void) | null;
};

function traceFrame<TView>(
  wiring: SceneFrameWiring<TView>,
  sample: ClockSample,
  frame: { readonly run: number; readonly timestamp: number; readonly isDone: boolean },
): void {
  const trace = wiring.trace;
  if (trace === null) return;
  const step = traceFrameStep(trace.window.get(), frame);
  trace.window.set(step.window);
  if (step.isSampled) scheduleOnRN(trace.onFrame, sample);
}

export function runSceneFrame<TView>(
  wiring: SceneFrameWiring<TView>,
  timestamp: number,
  dtMs: number | null = null,
): void {
  try {
    const current = wiring.scene.get();
    const run = wiring.run.get();
    const tick = tickClock(current, timestamp);
    if (current.startAt === NOT_STARTED) wiring.scene.set({ ...current, startAt: tick.startAt });
    wiring.now.set(timestamp);
    wiring.onFrameTime?.(dtMs);
    const sample = {
      run,
      seq: current.seq,
      startAt: tick.startAt,
      elapsedMs: tick.elapsedMs,
      endMs: current.endMs,
    };
    traceFrame(wiring, sample, { run, timestamp, isDone: tick.isDone });
    if (tick.isDone) scheduleOnRN(wiring.onDone, run, current.seq);
  } catch (error) {
    scheduleOnRN(wiring.onError, describeError(error));
  }
}
