// src/canvas/realtime/run-loop-frame.test.ts
import { STEP_MS } from '@/core/realtime/fixed-step';

import { runLoopFrame } from './run-loop-frame';

import type { LoopFrameWiring } from './run-loop-frame';
import type { SharedValue } from 'react-native-reanimated';

type Sim = { ticks: number[]; pending: number[] };

/** A plain stand-in for a shared value: get/set/modify are all the loop runner uses. */
function fakeShared<T>(initial: T): { shared: SharedValue<T>; modified: () => number } {
  let value = initial;
  let modified = 0;
  const shared = {
    get: () => value,
    set: (next: T) => {
      value = next;
    },
    modify: () => {
      modified += 1;
    },
  } as unknown as SharedValue<T>;
  return { shared, modified: () => modified };
}

function wiring(step: (sim: Sim, command: number) => void) {
  const sim = fakeShared<Sim>({ ticks: [], pending: [] });
  const onEvents = jest.fn();
  const onError = jest.fn();
  const frameTimes: (number | null)[] = [];
  const loop: LoopFrameWiring<Sim> = {
    sim: sim.shared,
    command: fakeShared(3).shared,
    accMs: fakeShared(0).shared,
    step,
    drainEvents: (state) => state.pending.splice(0),
    onEvents,
    onError,
    onFrameTime: (dtMs) => {
      frameTimes.push(dtMs);
    },
  };
  return { loop, sim, onEvents, onError, frameTimes };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

describe('runLoopFrame', () => {
  it('runs the planned ticks with the current command and notifies the picture once', async () => {
    const { loop, sim, onEvents } = wiring((state, command) => {
      state.ticks.push(command);
      state.pending.push(1, command, state.ticks.length);
    });
    runLoopFrame(loop, 2 * STEP_MS);
    await flush();
    expect(sim.shared.get().ticks).toStrictEqual([3, 3]);
    expect(sim.modified()).toBe(1);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenCalledWith([1, 3, 1, 1, 3, 2]);
  });

  it('simulates nothing on the first frame after activation', () => {
    const step = jest.fn();
    const { loop, sim } = wiring(step);
    runLoopFrame(loop, null);
    expect(step).not.toHaveBeenCalled();
    expect(sim.modified()).toBe(0);
  });

  it('sends no batch when a frame produced no events', async () => {
    const { loop, onEvents, sim } = wiring(() => undefined);
    runLoopFrame(loop, STEP_MS);
    await flush();
    expect(sim.modified()).toBe(1);
    expect(onEvents).not.toHaveBeenCalled();
  });

  it('samples the frame time once per frame, zero-step frames included', () => {
    const { loop, frameTimes } = wiring(() => undefined);
    runLoopFrame(loop, null);
    runLoopFrame(loop, STEP_MS / 4);
    runLoopFrame(loop, 2 * STEP_MS);
    expect(frameTimes).toStrictEqual([null, STEP_MS / 4, 2 * STEP_MS]);
  });

  it('runs without a frame-time recorder (store builds)', () => {
    const step = jest.fn();
    const { loop } = wiring(step);
    runLoopFrame({ ...loop, onFrameTime: null }, STEP_MS);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('reports a sim exception instead of crashing the UI thread', async () => {
    const { loop, onError } = wiring(() => {
      throw new RangeError('entity overflow');
    });
    runLoopFrame(loop, STEP_MS);
    await flush();
    expect(onError).toHaveBeenCalledWith('RangeError: entity overflow');
  });
});
