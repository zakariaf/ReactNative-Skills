// src/features/tasks/swipe-action.ts
// Physical sides as data: a swipe left completes a task in every language (gestures are physical).
export type Swipe = 'left' | 'right';
export const SWIPE_DELTAS = { left: { x: -1 }, right: { x: 1 } } as const;

export function swipeOf(dx: number): Swipe {
  return dx < 0 ? 'left' : 'right';
}
