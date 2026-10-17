// src/canvas/scene-clock-state.ts
'worklet';

import { NOT_STARTED } from './scene';

import type { Scene } from './scene';

/**
 * The scene clock's decisions as plain data, so Jest can replay recorded traces through them.
 * useSceneClock (JS) routes push, stop, resume and every done message through these functions,
 * and the frame runner (UI) asks traceFrameStep; nothing here touches Reanimated.
 *
 * Why the JS side keeps its own record: a JS read of a shared value returns the JS thread's cached
 * copy until the UI thread has applied the newest JS write (verified on Reanimated 4.5.1). A done
 * message that compared its seq with scene.get() could therefore read the scene from before a push
 * and stop the new scene on its first frame (the frozen surface after an interruption: see the
 * timeline-and-clock reference).
 */

/** The clock trace's labels (debug builds that pass a trace sink). */
export type ClockTraceLabel = 'push' | 'stop' | 'resume' | 'frame' | 'done' | 'runnable';

export type ClockControl = {
  /** seq of the last pushed scene. */
  readonly seq: number;
  /** Its timeline's length (the trace reports it). */
  readonly endMs: number;
  /** Bumped by every push, stop, resume and halt: a done message names the run that ended. */
  readonly run: number;
  /** App active, screen focused and nothing covering the surface (useCanvasLifecycle). */
  readonly isRunnable: boolean;
  /** Whether the frame callback is meant to run. */
  readonly isActive: boolean;
};

/** One decision: the next record and what to do with the frame callback (null: leave it). */
export type ClockStep = {
  readonly control: ClockControl;
  readonly setActive: boolean | null;
  /** False for a stale message that changed nothing. */
  readonly isApplied: boolean;
};

/** What the decisions need of a scene. */
export type SceneHead = Pick<Scene<unknown>, 'seq' | 'endMs'>;

/** Mounted, not yet told whether the surface may run: nothing plays until the first resume. */
export function initialClockControl(scene: SceneHead): ClockControl {
  return { seq: scene.seq, endMs: scene.endMs, run: 0, isRunnable: false, isActive: false };
}

/**
 * A new scene (always startAt NOT_STARTED): it plays at once while the surface is runnable, and is
 * held while it is not, so it starts on the first frame after the surface can be seen again.
 */
export function pushScene(control: ClockControl, scene: SceneHead): ClockStep {
  const isActive = control.isRunnable;
  const { seq, endMs } = scene;
  return {
    control: { seq, endMs, run: control.run + 1, isRunnable: control.isRunnable, isActive },
    setActive: isActive ? true : null,
    isApplied: true,
  };
}

/** The surface may not run (background, blur, a full-screen overlay): stop, void every done. */
export function stopClock(control: ClockControl): ClockStep {
  return {
    control: { ...control, run: control.run + 1, isRunnable: false, isActive: false },
    setActive: false,
    isApplied: true,
  };
}

/**
 * The surface may run again. The clock always starts, even when the scene has ended, so at least
 * one frame is recorded after the surface is visible: the canvas never keeps a picture recorded
 * while it was covered. A scene interrupted mid-way jumps to its end; a held scene starts now.
 */
export function resumeClock(control: ClockControl): ClockStep {
  return {
    control: { ...control, run: control.run + 1, isRunnable: true, isActive: true },
    setActive: true,
    isApplied: true,
  };
}

/** A draw or frame error: stop until the next push or resume (the screen reports it). */
export function haltClock(control: ClockControl): ClockStep {
  return {
    control: { ...control, run: control.run + 1, isActive: false },
    setActive: false,
    isApplied: true,
  };
}

/** The frame runner's done message stops the clock only for the run that is still current. */
export function finishRun(control: ClockControl, run: number): ClockStep {
  if (run !== control.run || !control.isActive)
    return { control, setActive: null, isApplied: false };
  return { control: { ...control, isActive: false }, setActive: false, isApplied: true };
}

/** Debug traces: the frames of each run are traced for this long after its first frame... */
export const TRACE_WINDOW_MS = 2000;
/** ...at most one every this many ms, plus the first frame and the frame that ends the scene. */
export const TRACE_SAMPLE_MS = 100;

/** The UI thread's trace window: which run it belongs to, when it ends, the last sample. */
export type TraceWindow = {
  readonly run: number;
  readonly untilMs: number;
  readonly lastMs: number;
};

export const NO_TRACE_WINDOW: TraceWindow = { run: -1, untilMs: 0, lastMs: 0 };

export type TraceFrameStep = { readonly window: TraceWindow; readonly isSampled: boolean };

/** Whether this frame goes into the trace; a new run opens a new window on its first frame. */
export function traceFrameStep(
  window: TraceWindow,
  frame: { readonly run: number; readonly timestamp: number; readonly isDone: boolean },
): TraceFrameStep {
  const { run, timestamp, isDone } = frame;
  if (window.run !== run) {
    return {
      window: { run, untilMs: timestamp + TRACE_WINDOW_MS, lastMs: timestamp },
      isSampled: true,
    };
  }
  const isDue = isDone || timestamp - window.lastMs >= TRACE_SAMPLE_MS;
  if (timestamp > window.untilMs || !isDue) return { window, isSampled: false };
  return { window: { ...window, lastMs: timestamp }, isSampled: true };
}

/** What the picture shows: the scene's seq and whether it was recorded at the scene's end. */
export type SceneFrame = { readonly seq: number; readonly settled: boolean };

export function sceneFrameOf(
  scene: Pick<Scene<unknown>, 'seq' | 'startAt' | 'endMs'>,
  now: number,
): SceneFrame {
  const isSettled = scene.startAt !== NOT_STARTED && now - scene.startAt >= scene.endMs;
  return { seq: scene.seq, settled: isSettled };
}

/** The probe text an end-to-end flow reads (<prefix>.canvas-frame). */
export function sceneFrameText(frame: SceneFrame): string {
  return JSON.stringify({ seq: frame.seq, settled: frame.settled });
}
