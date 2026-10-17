// src/features/tasks/canvas/intent-to-action.ts
// Tap a day of the progress grid to toggle it. toView turns state into what the canvas draws; this
// turns what the finger did back into a domain action, or nothing. Pure: no React, no store, no Skia.
import { listDayActions } from '@/features/tasks/progress-grid-rules';

import type { ProgressGridAction, ProgressGridState } from './canvas-model';
import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';

/** Regions whose taps select instead of act (a tap-then-tap surface lists them); the grid has none. */
export const SELECT_REGIONS: readonly string[] = [];

/** A grid cell that exists in this state (hit-testing clamps, but intents also come from tests). */
function isOnGrid(state: ProgressGridState, target: CanvasTarget): boolean {
  const { col, row } = target;
  return target.regionId === 'grid' && col >= 0 && row >= 0 && col < state.cols && row < state.rows;
}

/** The action a gesture points at, before legality. Every kind is listed, so a new one fails tsc. */
function candidate(state: ProgressGridState, intent: CanvasIntent): ProgressGridAction | null {
  switch (intent.kind) {
    case 'tap':
      return isOnGrid(state, intent.target)
        ? { kind: 'toggle-day', cell: intent.target.row * state.cols + intent.target.col }
        : null;
    case 'long-press':
    case 'swipe':
    case 'drag-end':
    case 'aim':
      return null;
  }
}

/** An intent becomes an action the domain lists, or null (also once the week is closed). */
export function intentToAction(
  state: ProgressGridState,
  intent: CanvasIntent,
): ProgressGridAction | null {
  const action = candidate(state, intent);
  if (action === null) return null;
  return listDayActions(state).some((listed) => listed.cell === action.cell) ? action : null;
}
