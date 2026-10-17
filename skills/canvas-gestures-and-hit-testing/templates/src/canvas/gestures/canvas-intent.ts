// src/canvas/gestures/canvas-intent.ts
import type { SwipeDirection } from './classify-swipe';
import type { CanvasTarget } from '@/canvas/canvas-layout';

/**
 * What the finger did, in canvas terms. Produced on the UI thread by useCanvasGestures, delivered
 * to JS with scheduleOnRN, and turned into a domain action by the surface's pure intentToAction().
 *
 * A tap carries the screen's selection: the target of an earlier tap inside one of the surface's
 * select regions (an inbox chip, a game piece), or null. The selection is UI state the screen's
 * model hook keeps, never domain state and never an action, so persistence, undo, analytics and
 * automated players never see it. The gesture layer always sends `selected: null`; the model hook
 * fills it in.
 */
export type CanvasIntent =
  | { readonly kind: 'tap'; readonly target: CanvasTarget; readonly selected: CanvasTarget | null }
  | { readonly kind: 'long-press'; readonly target: CanvasTarget }
  | {
      readonly kind: 'swipe';
      readonly direction: SwipeDirection;
      readonly from: CanvasTarget | null;
    }
  | { readonly kind: 'drag-end'; readonly from: CanvasTarget; readonly to: CanvasTarget | null }
  /** Release vector of an aim drag (pull back and let go), in canvas points. */
  | { readonly kind: 'aim'; readonly dx: number; readonly dy: number };
