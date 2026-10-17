// src/canvas/realtime/run-loop-frame.ts
'worklet';

import { scheduleOnRN } from 'react-native-worklets';

import { describeError } from '@/canvas/describe-error';
import { planSteps } from '@/core/realtime/fixed-step';

import type { SharedValue } from 'react-native-reanimated';

/** Everything the real-time loop's frame callback needs; JS callbacks arrive via scheduleOnRN. */
export type LoopFrameWiring<TSim> = {
  readonly sim: SharedValue<TSim>;
  readonly command: SharedValue<number>;
  readonly accMs: SharedValue<number>;
  readonly step: (sim: TSim, command: number) => void;
  readonly drainEvents: (sim: TSim) => readonly number[];
  readonly onEvents: (events: readonly number[]) => void;
  readonly onError: (message: string) => void;
  /** A frame-time recorder (a worklet that samples dtMs while recording); null in store builds. */
  readonly onFrameTime: ((dtMs: number | null) => void) | null;
};

/**
 * The whole body of the loop's frame callback: sample the frame time, plan the ticks, step the live
 * sim in place, notify the picture once, send this frame's events to JS in one batch. Never throws
 * on the UI thread.
 */
export function runLoopFrame<TSim>(wiring: LoopFrameWiring<TSim>, frameDtMs: number | null): void {
  try {
    wiring.onFrameTime?.(frameDtMs);
    const plan = planSteps(wiring.accMs.get(), frameDtMs);
    wiring.accMs.set(plan.accMs);
    if (plan.steps === 0) return;
    const input = wiring.command.get();
    const state = wiring.sim.get(); // on the UI thread: the live object, not a copy
    for (let i = 0; i < plan.steps; i += 1) wiring.step(state, input);
    const events = wiring.drainEvents(state);
    wiring.sim.modify(); // mutated in place: force listeners (the picture) to re-run
    if (events.length > 0) scheduleOnRN(wiring.onEvents, events);
  } catch (error) {
    scheduleOnRN(wiring.onError, describeError(error));
  }
}
