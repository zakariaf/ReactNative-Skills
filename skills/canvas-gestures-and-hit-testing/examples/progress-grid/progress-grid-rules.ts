// src/features/tasks/progress-grid-rules.ts
// The feature's one source of truth for what the user may do on the progress grid. The intent
// function, the "suggest a day" hint and the tests all ask this list, so they can never disagree.
import type { ProgressGridAction, ProgressGridState } from '@/features/tasks/canvas/canvas-model';

/** Every day of the grid can be toggled until every day is done: then the week is closed. */
export function listDayActions(state: ProgressGridState): readonly ProgressGridAction[] {
  if (state.cells.every((cell) => cell === 1)) return [];
  return state.cells.map((_, cell) => ({ kind: 'toggle-day', cell }));
}
