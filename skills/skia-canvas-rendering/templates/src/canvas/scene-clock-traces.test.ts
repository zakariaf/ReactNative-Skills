// src/canvas/scene-clock-traces.test.ts
// Replays two clock traces recorded on an iOS simulator (Release build) through the clock's
// decisions, in the order the JS thread wrote them:
// - interrupted: a full-screen overlay covers the surface (the clock stops); when it closes, the
//   lifecycle resumes the clock (run 4) on the old, long-ended scene, and 21 ms later the follow-up
//   change is pushed (run 5, seq 2). The UI's resume frame of run 4 (the old scene) then reports
//   done. A hook that compared the done seq with a JS read of the scene shared value still read
//   seq 1 (the UI had not applied the push yet) and stopped the clock: the new scene never got a
//   frame (the frozen surface);
// - uninterrupted: the same follow-up change without an overlay plays 0..550 ms, then done.
// Invariant: when a trace ends with the surface runnable, its last pushed scene has either been
// recorded at its end or the clock is still running to get there.
import {
  finishRun,
  initialClockControl,
  pushScene,
  resumeClock,
  stopClock,
} from './scene-clock-state';

import type { ClockControl, ClockStep } from './scene-clock-state';

type Recorded =
  | { readonly label: 'push'; readonly run: number; readonly seq: number; readonly endMs: number }
  | { readonly label: 'stop' }
  | { readonly label: 'resume'; readonly run: number }
  | {
      readonly label: 'frame';
      readonly run: number;
      readonly seq: number;
      readonly elapsedMs: number;
      readonly endMs: number;
    }
  /** readSeq: what a JS read of scene.get().seq returned when this message arrived. */
  | {
      readonly label: 'done';
      readonly run: number;
      readonly seq: number;
      readonly readSeq: number;
    };

const OPENING: readonly Recorded[] = [
  { label: 'push', run: 1, seq: 0, endMs: 0 },
  { label: 'resume', run: 2 },
  { label: 'frame', run: 2, seq: 0, elapsedMs: 0, endMs: 0 },
  { label: 'done', run: 2, seq: 0, readSeq: 0 },
  { label: 'push', run: 3, seq: 1, endMs: 0 },
  { label: 'frame', run: 3, seq: 1, elapsedMs: 0, endMs: 0 },
  { label: 'done', run: 3, seq: 1, readSeq: 1 },
];

const INTERRUPTED: readonly Recorded[] = [
  ...OPENING,
  { label: 'stop' }, // a full-screen overlay covers the surface
  { label: 'resume', run: 4 }, // it closed, 66 s later
  { label: 'push', run: 5, seq: 2, endMs: 540 }, // the follow-up change, 21 ms after the resume
  { label: 'frame', run: 4, seq: 1, elapsedMs: 75_566, endMs: 0 }, // the UI still had seq 1
  { label: 'done', run: 4, seq: 1, readSeq: 1 }, // a seq guard reads 1 === 1 and stops the clock
];

const UNINTERRUPTED: readonly Recorded[] = [
  ...OPENING,
  { label: 'push', run: 4, seq: 2, endMs: 540 },
  ...[0, 100, 200, 300, 400, 517, 550].map(
    (elapsedMs) => ({ label: 'frame', run: 4, seq: 2, elapsedMs, endMs: 540 }) as const,
  ),
  { label: 'done', run: 4, seq: 2, readSeq: 2 },
];

/** How a hook answers the trace's messages; isActive: whether its frame callback runs at the end. */
type ClockLogic = {
  readonly apply: (event: Exclude<Recorded, { label: 'frame' }>) => void;
  readonly isActive: () => boolean;
};

/** The seq-guard hook that froze: kept here as the regression's reference. */
function seqGuardLogic(): ClockLogic {
  let isActive = false;
  return {
    apply: (event) => {
      if (event.label === 'push' || event.label === 'resume') isActive = true;
      if (event.label === 'stop') isActive = false;
      if (event.label === 'done' && event.seq === event.readSeq) isActive = false;
    },
    isActive: () => isActive,
  };
}

/** scene-clock-state, as useSceneClock applies it; recorded runs map to the replay's runs. */
function runTokenLogic(): ClockLogic {
  let control: ClockControl = initialClockControl({ seq: 0, endMs: 0 });
  const runs = new Map<number, number>();
  const step = (next: ClockStep, recordedRun: number | null): void => {
    control = next.control;
    if (recordedRun !== null) runs.set(recordedRun, control.run);
  };
  return {
    apply: (event) => {
      if (event.label === 'push') step(pushScene(control, event), event.run);
      if (event.label === 'resume') step(resumeClock(control), event.run);
      if (event.label === 'stop') step(stopClock(control), null);
      if (event.label === 'done') step(finishRun(control, runs.get(event.run) ?? -1), null);
    },
    isActive: () => control.isActive,
  };
}

type Outcome = { readonly lastSeq: number; readonly isEnded: boolean; readonly isRunning: boolean };

function replay(trace: readonly Recorded[], logic: ClockLogic): Outcome {
  let last = { seq: -1, endMs: 0 };
  let isEnded = false;
  for (const event of trace) {
    if (event.label === 'frame') {
      isEnded ||= event.seq === last.seq && event.elapsedMs >= last.endMs;
      continue;
    }
    if (event.label === 'push') {
      last = event;
      isEnded = false;
    }
    logic.apply(event);
  }
  return { lastSeq: last.seq, isEnded, isRunning: logic.isActive() };
}

/** The last pushed scene was recorded at its end, or the clock still runs toward it. */
function isFrozen(outcome: Outcome): boolean {
  return !outcome.isEnded && !outcome.isRunning;
}

describe('the recorded scene-clock traces', () => {
  it('reproduces the frozen surface with the seq-guard hook (the reference)', () => {
    expect(replay(INTERRUPTED, seqGuardLogic())).toStrictEqual({
      lastSeq: 2,
      isEnded: false,
      isRunning: false,
    });
  });

  it('keeps the clock running for the follow-up scene after an interruption', () => {
    const outcome = replay(INTERRUPTED, runTokenLogic());
    expect(outcome).toStrictEqual({ lastSeq: 2, isEnded: false, isRunning: true });
    expect(isFrozen(outcome)).toBe(false);
  });

  it.each([
    ['the seq guard', seqGuardLogic],
    ['scene-clock-state', runTokenLogic],
  ])('plays the uninterrupted change to its end with %s', (_name, logic) => {
    const outcome = replay(UNINTERRUPTED, logic());
    expect(outcome).toStrictEqual({ lastSeq: 2, isEnded: true, isRunning: false });
    expect(isFrozen(outcome)).toBe(false);
  });
});
