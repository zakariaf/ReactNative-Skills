// src/canvas/scene-clock-state.test.ts
// The scene clock's decisions as data. The recorded interruption traces are replayed in
// scene-clock-traces.test.ts.
import { NOT_STARTED } from './scene';
import {
  finishRun,
  haltClock,
  initialClockControl,
  NO_TRACE_WINDOW,
  pushScene,
  resumeClock,
  sceneFrameOf,
  sceneFrameText,
  stopClock,
  TRACE_SAMPLE_MS,
  TRACE_WINDOW_MS,
  traceFrameStep,
} from './scene-clock-state';

import type { ClockControl } from './scene-clock-state';

const RUNNING: ClockControl = { seq: 4, endMs: 300, run: 7, isRunnable: true, isActive: true };
const NEXT = { seq: 5, endMs: 540 };

describe('scene clock decisions', () => {
  it('holds a mounted surface until the lifecycle says it may run', () => {
    const mounted = pushScene(initialClockControl({ seq: 0, endMs: 0 }), { seq: 0, endMs: 0 });
    expect(mounted).toMatchObject({ setActive: null, control: { isActive: false } });
    expect(resumeClock(mounted.control)).toMatchObject({ setActive: true, control: { seq: 0 } });
  });

  it('plays a scene pushed while the surface is runnable at once, as a new run', () => {
    expect(pushScene(RUNNING, NEXT)).toStrictEqual({
      control: { seq: 5, endMs: 540, run: 8, isRunnable: true, isActive: true },
      setActive: true,
      isApplied: true,
    });
  });

  it('holds a scene pushed while the surface is not runnable, and starts it on resume', () => {
    const stopped = stopClock(RUNNING);
    expect(stopped).toMatchObject({ setActive: false, control: { isActive: false } });
    const held = pushScene(stopped.control, NEXT);
    expect(held).toMatchObject({ setActive: null, control: { seq: 5, isActive: false } });
    const resumed = resumeClock(held.control);
    expect(resumed).toMatchObject({ setActive: true, control: { seq: 5, isActive: true } });
  });

  it('runs at least one frame on every resume, even when the scene has ended', () => {
    const ended = finishRun(RUNNING, RUNNING.run);
    expect(ended).toMatchObject({ setActive: false, isApplied: true });
    const stopped = stopClock(ended.control);
    expect(resumeClock(stopped.control)).toMatchObject({ setActive: true, isApplied: true });
  });

  it('ignores a stale done message, so it cannot stop a newer scene', () => {
    // The old scene's done was in flight when the next scene was pushed.
    const pushed = pushScene(RUNNING, NEXT);
    const stale = finishRun(pushed.control, RUNNING.run);
    expect(stale).toStrictEqual({ control: pushed.control, setActive: null, isApplied: false });
    expect(finishRun(pushed.control, pushed.control.run)).toMatchObject({ setActive: false });
  });

  it('ignores a done from before a stop and resume, so the resumed clock keeps running', () => {
    const resumed = resumeClock(stopClock(RUNNING).control);
    expect(finishRun(resumed.control, RUNNING.run)).toMatchObject({ isApplied: false });
  });

  it('ignores a done message once the clock is already stopped', () => {
    const stopped = stopClock(RUNNING).control;
    expect(finishRun(stopped, stopped.run)).toMatchObject({ isApplied: false, setActive: null });
  });

  it('halts on a frame error until the next push or resume, keeping runnable', () => {
    const halted = haltClock(RUNNING);
    expect(halted).toMatchObject({ setActive: false, control: { isRunnable: true } });
    expect(pushScene(halted.control, NEXT)).toMatchObject({ setActive: true });
  });
});

describe('traceFrameStep', () => {
  it('samples the first frame of a run, then one per sample interval and the last frame', () => {
    const first = traceFrameStep(NO_TRACE_WINDOW, { run: 3, timestamp: 1000, isDone: false });
    expect(first).toStrictEqual({
      window: { run: 3, untilMs: 1000 + TRACE_WINDOW_MS, lastMs: 1000 },
      isSampled: true,
    });
    const soon = traceFrameStep(first.window, { run: 3, timestamp: 1016, isDone: false });
    expect(soon.isSampled).toBe(false);
    const due = traceFrameStep(first.window, {
      run: 3,
      timestamp: 1000 + TRACE_SAMPLE_MS,
      isDone: false,
    });
    expect(due.isSampled).toBe(true);
    expect(traceFrameStep(first.window, { run: 3, timestamp: 1033, isDone: true }).isSampled).toBe(
      true,
    );
  });

  it('stops sampling after the window and opens a new one for the next run', () => {
    const open = traceFrameStep(NO_TRACE_WINDOW, { run: 3, timestamp: 0, isDone: false }).window;
    const late = TRACE_WINDOW_MS + 16;
    expect(traceFrameStep(open, { run: 3, timestamp: late, isDone: true }).isSampled).toBe(false);
    expect(traceFrameStep(open, { run: 4, timestamp: late, isDone: false }).isSampled).toBe(true);
  });
});

describe('sceneFrameOf', () => {
  it('is not settled before the first frame or while the timeline plays', () => {
    expect(sceneFrameOf({ seq: 2, startAt: NOT_STARTED, endMs: 300 }, 5000)).toStrictEqual({
      seq: 2,
      settled: false,
    });
    expect(sceneFrameOf({ seq: 2, startAt: 5000, endMs: 300 }, 5000).settled).toBe(false);
  });

  it('is settled once a frame was recorded at or after the end', () => {
    expect(sceneFrameOf({ seq: 2, startAt: 5000, endMs: 300 }, 5300).settled).toBe(true);
    expect(sceneFrameOf({ seq: 0, startAt: 10, endMs: 0 }, 10).settled).toBe(true);
  });

  it('writes the probe text a flow matches', () => {
    expect(sceneFrameText({ seq: 2, settled: true })).toBe('{"seq":2,"settled":true}');
  });
});
