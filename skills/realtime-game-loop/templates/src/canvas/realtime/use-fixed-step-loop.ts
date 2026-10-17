// src/canvas/realtime/use-fixed-step-loop.ts
// device-only: covered by the simulator play-through of a real-time level (useFrameCallback needs the UI thread; run-loop-frame.test.ts proves the frame body).
import { useEffect, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { runLoopFrame } from './run-loop-frame';

import type { FixedStepSim } from '@/core/realtime/realtime-spec';
import type { FrameCallback, SharedValue } from 'react-native-reanimated';

export type FixedStepLoop = { readonly start: () => void; readonly stop: () => void };

type LoopWiring<TSim> = {
  readonly sim: SharedValue<TSim>;
  /** Current input command (a quantised integer, written by gesture worklets). */
  readonly command: SharedValue<number>;
  /** Stable for the life of the surface (a module-level spec): a new step re-registers the frame callback. */
  readonly game: FixedStepSim<TSim>;
  /** JS: batched events for sound, HUD, statistics and save points; at most once per frame. */
  readonly onEvents: (events: readonly number[]) => void;
  readonly onError: (message: string) => void;
  /** A frame-time recorder (a module-level worklet, so its identity is stable); null in store builds. */
  readonly onFrameTime: ((dtMs: number | null) => void) | null;
};

type JsHandlers = Pick<LoopWiring<unknown>, 'onEvents' | 'onError'>;

/**
 * Constant functions that call the latest JS handlers (kept in a ref, assigned in an effect). A frame
 * callback with a new identity is registered again, and its next frame has no
 * timeSincePreviousFrame, so a handler that changes on every event batch would drop game time.
 */
function useStableHandlers(
  handlers: JsHandlers,
  frameRef: { readonly current: FrameCallback | null },
): JsHandlers {
  const handlersRef = useRef<JsHandlers>(handlers);
  const { onEvents, onError } = handlers;
  useEffect(() => {
    handlersRef.current = { onEvents, onError };
  }, [onEvents, onError]);
  const [stable] = useState<JsHandlers>(() => ({
    onEvents: (events) => {
      handlersRef.current.onEvents(events);
    },
    onError: (message) => {
      frameRef.current?.setActive(false);
      handlersRef.current.onError(message);
    },
  }));
  return stable;
}

/** The fixed-step loop: created inactive; start() resets the accumulator, so a resume never jumps. */
export function useFixedStepLoop<TSim>(input: LoopWiring<TSim>): FixedStepLoop {
  const accMs = useSharedValue(0);
  const frameRef = useRef<FrameCallback | null>(null);
  const trampolines = useStableHandlers(input, frameRef);
  const { sim, command, game, onFrameTime } = input;
  const wiring = {
    sim,
    command,
    accMs,
    step: game.step,
    drainEvents: game.drainEvents,
    onEvents: trampolines.onEvents,
    onError: trampolines.onError,
    onFrameTime,
  };
  const frame = useFrameCallback((info) => {
    runLoopFrame(wiring, info.timeSincePreviousFrame);
  }, false);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  return {
    start: () => {
      accMs.set(0);
      frame.setActive(true);
    },
    stop: () => {
      frame.setActive(false);
    },
  };
}
