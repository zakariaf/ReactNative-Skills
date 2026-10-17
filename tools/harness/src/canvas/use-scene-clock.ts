// src/canvas/use-scene-clock.ts
// device-only: covered by scene-clock-state.test.ts, scene-clock-traces.test.ts and the canvas end-to-end flow (useFrameCallback needs the UI thread).
import { useEffect, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { runSceneFrame } from './run-scene-frame';
import {
  finishRun,
  haltClock,
  initialClockControl,
  NO_TRACE_WINDOW,
  pushScene,
  resumeClock,
  stopClock,
} from './scene-clock-state';

import type { ClockSample } from './run-scene-frame';
import type { Scene } from './scene';
import type { ClockStep, ClockTraceLabel, SceneHead } from './scene-clock-state';
import type { FrameCallback, SharedValue } from 'react-native-reanimated';

export type SceneClock<TView> = {
  readonly scene: SharedValue<Scene<TView>>;
  /** Latest FrameInfo.timestamp seen by the clock; the picture reads it to re-record. */
  readonly now: SharedValue<number>;
  /** JS: show a new scene; it plays now while the surface is runnable, else once it is again. */
  readonly push: (next: Scene<TView>) => void;
  /** JS: the surface may not run (background, blur, an overlay): stop the clock. */
  readonly stop: () => void;
  /** JS: the surface may run again: at least one frame; an interrupted timeline jumps to its end. */
  readonly resume: () => void;
  /** JS, debug builds: one trace entry with the clock's last seq and run (no-op without a sink). */
  readonly trace: (label: ClockTraceLabel) => void;
};

/** A JS-side trace entry: the UI's numbers for frames, the last pushed scene's for the rest. */
export type ClockTraceSample = Omit<ClockSample, 'startAt' | 'elapsedMs'> & {
  readonly startAt: number | null;
  readonly elapsedMs: number | null;
  /** 'done' only: the message named an older run, so it changed nothing. */
  readonly isStale?: boolean;
};
export type ClockTraceSink = (label: ClockTraceLabel, sample: ClockTraceSample) => void;

export type SceneClockOptions = {
  /** Debug builds: where clock events go (a log, a perf buffer); null otherwise. */
  readonly trace: ClockTraceSink | null;
  /** A frame-time recorder (a worklet); null otherwise. */
  readonly onFrameTime: ((dtMs: number | null) => void) | null;
};

const NO_OPTIONS: SceneClockOptions = { trace: null, onFrameTime: null };

type Push = (next: SceneHead & Pick<Scene<unknown>, 'startAt'>) => void;

/** What the driver reaches once the surface has rendered (useSceneClock's effect). */
type DriverParts = {
  readonly frame: Pick<FrameCallback, 'setActive'>;
  readonly sink: ClockTraceSink | null;
  readonly onError: (message: string) => void;
};

/** The clock's JS half, one per surface: every switch is a scene-clock-state step. */
type ClockDriver = Pick<SceneClock<unknown>, 'stop' | 'resume' | 'trace'> & {
  readonly connect: (parts: DriverParts) => void;
  readonly push: Push;
  /** The frame runner's done message: stops the clock only for the run that is still current. */
  readonly onDone: (doneRun: number, seq: number) => void;
  /** A draw or frame error: halt, then report it. */
  readonly onError: (message: string) => void;
};

/**
 * JS keeps its own record of the clock and never reads the scene shared value back. Created once
 * per surface (useState), so onDone and onError keep their identity inside the frame callback.
 */
function createClockDriver(initial: SceneHead, run: Pick<SharedValue<number>, 'set'>): ClockDriver {
  let control = initialClockControl(initial);
  let parts: DriverParts | null = null;
  const trace = (label: ClockTraceLabel, sample: Partial<ClockTraceSample> = {}): void => {
    const base = { seq: control.seq, endMs: control.endMs, run: control.run };
    parts?.sink?.(label, { ...base, startAt: null, elapsedMs: null, ...sample });
  };
  // The one place the frame callback is switched: the run reaches the UI before the frame does.
  const apply = (step: ClockStep, label: ClockTraceLabel | null): void => {
    control = step.control;
    if (step.setActive === true) run.set(step.control.run);
    if (step.setActive !== null) parts?.frame.setActive(step.setActive);
    if (label !== null) trace(label);
  };
  return {
    connect: (next) => {
      parts = next;
    },
    push: (next) => {
      apply(pushScene(control, next), null);
      trace('push', { startAt: next.startAt, elapsedMs: 0 });
    },
    stop: () => {
      apply(stopClock(control), 'stop');
    },
    resume: () => {
      apply(resumeClock(control), 'resume');
    },
    trace,
    onDone: (doneRun, seq) => {
      const isStale = doneRun !== control.run;
      const step = finishRun(control, doneRun);
      apply(step, null);
      if (step.isApplied || isStale) trace('done', { seq, run: doneRun, isStale });
    },
    onError: (message) => {
      apply(haltClock(control), null);
      parts?.onError(message);
    },
  };
}

/**
 * The frame clock. Every decision goes through scene-clock-state: JS keeps its own record of the
 * last push and the current run, and never reads the scene shared value (a JS read can return the
 * scene from before the last push until the UI thread has applied it). A done message names the
 * run it ended, so a stale one never stops a newer scene or a resume.
 */
export function useSceneClock<TView>(
  initial: Scene<TView>,
  onError: (message: string) => void,
  options: SceneClockOptions = NO_OPTIONS,
): SceneClock<TView> {
  const scene = useSharedValue(initial);
  const now = useSharedValue(0);
  const run = useSharedValue(0);
  const window = useSharedValue(NO_TRACE_WINDOW);
  const [driver] = useState(() => createClockDriver(initial, run));
  const { trace: sink, onFrameTime } = options;
  const onFrame = (sample: ClockSample): void => {
    sink?.('frame', sample);
  };
  const trace = sink === null ? null : { window, onFrame };
  const { onDone } = driver;
  const wiring = { scene, now, run, onDone, onError: driver.onError, trace, onFrameTime };
  const frame = useFrameCallback((info) => {
    runSceneFrame(wiring, info.timestamp, info.timeSincePreviousFrame);
  }, false);
  useEffect(() => {
    driver.connect({ frame, sink, onError });
  }, [driver, frame, sink, onError]);
  return {
    scene,
    now,
    push: (next) => {
      scene.set(next);
      driver.push(next);
    },
    stop: driver.stop,
    resume: driver.resume,
    trace: driver.trace,
  };
}
