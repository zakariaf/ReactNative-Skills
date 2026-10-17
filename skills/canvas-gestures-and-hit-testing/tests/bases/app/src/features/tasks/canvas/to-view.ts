// src/features/tasks/canvas/to-view.ts
// Stand-in for skia-canvas-rendering's template view.
import type { ProgressGridState } from './canvas-model';

export type ProgressGridView = {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly number[];
  readonly streakText: string;
};

export function toView(state: ProgressGridState): ProgressGridView {
  return { cols: state.cols, rows: state.rows, cells: state.cells, streakText: String(state.streakDays) };
}
