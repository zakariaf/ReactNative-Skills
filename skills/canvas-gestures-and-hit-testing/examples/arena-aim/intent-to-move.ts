// src/games/arena/canvas/intent-to-move.ts
// A simple arena: pull back and let go to launch the runner; it flies opposite to the pull. The aim
// is quantised to integers before it enters state, so saves stay compact and replays are exact on
// every device (Math.sqrt is exactly specified by IEEE 754; sin, cos and atan2 are not).
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';

export type ArenaState = { readonly launchesLeft: number };

/** Launch direction as a unit vector in thousandths (integers), y pointing down. */
export type ArenaMove = {
  readonly kind: 'launch-runner';
  readonly aimX: number;
  readonly aimY: number;
};

/** Shorter pulls are a slip of the finger. */
const MIN_PULL_PT = 20;
const AIM_SCALE = 1000;

/** Release vector → a launch upwards, or null. */
export function aimMove(dx: number, dy: number): ArenaMove | null {
  const pull = Math.sqrt(dx * dx + dy * dy);
  if (pull < MIN_PULL_PT) return null;
  const aimX = Math.round((-dx / pull) * AIM_SCALE) + 0;
  const aimY = Math.round((-dy / pull) * AIM_SCALE) + 0;
  return aimY < 0 ? { kind: 'launch-runner', aimX, aimY } : null;
}

export function intentToMove(state: ArenaState, intent: CanvasIntent): ArenaMove | null {
  if (state.launchesLeft === 0) return null;
  switch (intent.kind) {
    case 'aim':
      return aimMove(intent.dx, intent.dy);
    case 'tap':
    case 'long-press':
    case 'swipe':
    case 'drag-end':
      return null;
  }
}
