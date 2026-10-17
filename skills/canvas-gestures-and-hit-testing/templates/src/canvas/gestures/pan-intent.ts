// src/canvas/gestures/pan-intent.ts
'worklet';

import { hitTest } from '@/canvas/canvas-layout';

import { classifySwipe } from './classify-swipe';

import type { CanvasIntent } from './canvas-intent';
import type { CanvasLayout, Point } from '@/canvas/canvas-layout';
import type { PointerSample } from '@/canvas/canvas-types';

/**
 * How a surface uses pans: 'none' (taps and long presses only), 'swipe' (one physical direction),
 * 'drag' (from one target to another) or 'aim' (pull back and let go). Long press is always on.
 */
export type PanMode = 'none' | 'swipe' | 'drag' | 'aim';

/** Extra hit area (pt) around regions, so edge taps still land; targets themselves stay >= 44 pt. */
export const HIT_SLOP = 8;

/**
 * The point a drag aims at: `dragLiftPt` above the finger, so the thumb does not hide the preview.
 * Applied once, here in the gesture layer, to the hover, the drawn preview and the drop target
 * alike; intentToAction and draw() never add a lift of their own.
 */
export function liftedPoint(point: Point, dragLiftPt: number): Point {
  return { x: point.x, y: point.y - dragLiftPt };
}

export type PanRelease = {
  readonly x: number;
  readonly y: number;
  readonly translationX: number;
  readonly translationY: number;
  readonly velocityX: number;
  readonly velocityY: number;
};

export type PanIntentInput = {
  readonly mode: PanMode;
  readonly pointer: PointerSample;
  readonly release: PanRelease;
  readonly layout: CanvasLayout;
  /** Lift of the drag pointer above the finger, in points (CanvasSurface.dragLiftPt, default 0). */
  readonly dragLiftPt: number;
};

/** Turns a finished pan into at most ONE intent, so a gesture can never produce two actions. */
export function panIntent(input: PanIntentInput): CanvasIntent | null {
  const { mode, pointer, release, layout, dragLiftPt } = input;
  switch (mode) {
    case 'none':
      return null;
    case 'swipe': {
      const swipe = {
        dx: release.translationX,
        dy: release.translationY,
        vx: release.velocityX,
        vy: release.velocityY,
      };
      const direction = classifySwipe(swipe);
      return direction === null ? null : { kind: 'swipe', direction, from: pointer.dragFrom };
    }
    case 'drag':
      return pointer.dragFrom === null
        ? null
        : {
            kind: 'drag-end',
            from: pointer.dragFrom,
            to: hitTest(layout, liftedPoint(release, dragLiftPt), HIT_SLOP),
          };
    case 'aim':
      return { kind: 'aim', dx: release.translationX, dy: release.translationY };
  }
}
