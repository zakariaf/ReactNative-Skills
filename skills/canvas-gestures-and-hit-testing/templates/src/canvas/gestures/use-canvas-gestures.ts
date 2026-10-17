// src/canvas/gestures/use-canvas-gestures.ts
// The ONLY file that builds canvas gestures with react-native-gesture-handler (2.32 builder API,
// Expo SDK 57). Moving to the 3.x hook API rewrites this file and nothing else. Every gesture
// yields at most ONE CanvasIntent; the surface's pure intentToAction decides what it means.
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { hitTest, isSameTarget } from '@/canvas/canvas-layout';
import { IDLE_POINTER } from '@/canvas/canvas-types';

import { HIT_SLOP, liftedPoint, panIntent } from './pan-intent';
import { STICK_IDLE, stickCommand } from './stick-command';

import type { CanvasIntent } from './canvas-intent';
import type { PanMode } from './pan-intent';
import type { CanvasLayout, CanvasTarget } from '@/canvas/canvas-layout';
import type { PointerSample } from '@/canvas/canvas-types';
import type {
  ExclusiveGesture,
  LongPressGesture,
  PanGesture,
  TapGesture,
} from 'react-native-gesture-handler';
import type { DerivedValue, SharedValue } from 'react-native-reanimated';

const TAP_MAX_MS = 250;
const LONG_PRESS_MS = 450;
const PAN_MIN_DISTANCE = 10;

export type CanvasGestureHandlers = {
  readonly panMode: PanMode;
  /**
   * Points a drag's pointer sits above the finger (CanvasSurface.dragLiftPt; 0 = none). The hover,
   * the drawn preview and the drop target all use the lifted point, so the preview is where the
   * item lands.
   */
  readonly dragLiftPt?: number;
  readonly onIntent: (intent: CanvasIntent) => void;
  /** The hovered target changed during a drag (JS may compute a preview of the action). */
  readonly onHover?: (target: CanvasTarget | null) => void;
  /** A tap that hit no region (beyond the hit slop): the screen drops its selection. Never an intent. */
  readonly onMiss?: () => void;
};

/** Matches the canvas kit's CanvasInput: pass it to <SurfaceCanvas input={...}>. */
export type CanvasGestures = {
  readonly gesture: ExclusiveGesture;
  readonly pointer: SharedValue<PointerSample>;
};

type Wiring = {
  readonly layout: DerivedValue<CanvasLayout>;
  readonly pointer: SharedValue<PointerSample>;
  readonly handlers: CanvasGestureHandlers;
};

function makeTap({ layout, handlers }: Wiring): TapGesture {
  const { onIntent, onMiss } = handlers;
  return Gesture.Tap()
    .withTestId('canvas.tap')
    .maxDuration(TAP_MAX_MS)
    .onEnd((event, isSuccess) => {
      if (!isSuccess) return;
      const target = hitTest(layout.get(), event, HIT_SLOP);
      // The model hook fills in `selected` (its UI-only selection); the gesture layer never knows it.
      if (target !== null) scheduleOnRN(onIntent, { kind: 'tap', target, selected: null });
      else if (onMiss !== undefined) scheduleOnRN(onMiss);
    });
}

function makeLongPress({ layout, handlers }: Wiring): LongPressGesture {
  const { onIntent } = handlers;
  return Gesture.LongPress()
    .withTestId('canvas.long-press')
    .minDuration(LONG_PRESS_MS)
    .onStart((event) => {
      const target = hitTest(layout.get(), event, HIT_SLOP);
      if (target !== null) scheduleOnRN(onIntent, { kind: 'long-press', target });
    });
}

function makePan({ layout, pointer, handlers }: Wiring): PanGesture {
  const { onIntent, onHover, panMode } = handlers;
  const dragLiftPt = handlers.dragLiftPt ?? 0;
  return Gesture.Pan()
    .withTestId('canvas.pan')
    .enabled(panMode !== 'none')
    .minDistance(PAN_MIN_DISTANCE)
    .onStart((event) => {
      // The press itself is never lifted: the drag starts where the finger went down.
      const origin = { x: event.x - event.translationX, y: event.y - event.translationY };
      const dragFrom = hitTest(layout.get(), origin, HIT_SLOP);
      const aim = liftedPoint(event, dragLiftPt);
      const hover = hitTest(layout.get(), aim, HIT_SLOP);
      pointer.set({ isDown: true, x: aim.x, y: aim.y, hover, dragFrom });
    })
    .onUpdate((event) => {
      const previous = pointer.get();
      const aim = liftedPoint(event, dragLiftPt);
      const hover = hitTest(layout.get(), aim, HIT_SLOP);
      pointer.set({ ...previous, x: aim.x, y: aim.y, hover });
      const hasMoved = !isSameTarget(hover, previous.hover);
      if (onHover !== undefined && hasMoved) scheduleOnRN(onHover, hover);
    })
    .onEnd((event, isSuccess) => {
      const release = { mode: panMode, pointer: pointer.get(), release: event, dragLiftPt };
      const intent = isSuccess ? panIntent({ ...release, layout: layout.get() }) : null;
      if (intent !== null) scheduleOnRN(onIntent, intent);
    })
    .onFinalize(() => {
      // Runs on success, failure and cancel (a call, the system back gesture): no stuck preview.
      pointer.set(IDLE_POINTER);
    });
}

/**
 * One Exclusive composition per canvas: pan beats long-press beats tap. `layout` is the derived
 * layout the picture draws with (useSurfacePlayer().layout), so draw and touch cannot drift.
 */
export function useCanvasGestures(
  layout: DerivedValue<CanvasLayout>,
  handlers: CanvasGestureHandlers,
): CanvasGestures {
  const pointer = useSharedValue<PointerSample>(IDLE_POINTER);
  const wiring = { layout, pointer, handlers };
  const gesture = Gesture.Exclusive(makePan(wiring), makeLongPress(wiring), makeTap(wiring));
  return { gesture, pointer };
}

/**
 * Continuous input (a one-thumb stick for a simulation): a pan anywhere writes an integer command
 * (0 idle, 1…16) into the loop's command shared value, only when it changes; lifting, failing or
 * cancelling writes 0. A plain builder (no hooks inside), so a host may call it during render.
 */
export function makeStickGesture(command: SharedValue<number>): PanGesture {
  return Gesture.Pan()
    .withTestId('canvas.stick')
    .minDistance(0)
    .onUpdate((event) => {
      const next = stickCommand(event.translationX, event.translationY);
      if (next !== command.get()) command.set(next);
    })
    .onFinalize(() => {
      command.set(STICK_IDLE);
    });
}
