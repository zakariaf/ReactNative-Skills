// src/features/__FEATURE__/canvas/canvas-ids.ts
'worklet';

/** Entity of the once-per-change tracks (the goal glow and burst, the streak label). */
export const CHANGE_ENTITY = 0;

/**
 * Entity id of a cell by its row-major index, shared by buildTimeline (JS thread) and draw (UI
 * thread), so cell tracks never collide with the change entity. A 'worklet' module: the draw
 * worklet may only call worklets.
 */
export function cellEntity(index: number): number {
  return 1000 + index;
}
