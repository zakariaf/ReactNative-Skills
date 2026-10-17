// src/features/__FEATURE__/canvas/to-view.ts
import type { __SURFACE_PASCAL__State } from './canvas-model';
import type { ViewFormat } from '@/canvas/canvas-types';

/** Flat and serialisable: it is copied into the scene shared value once per change. */
export type __SURFACE_PASCAL__View = {
  readonly cols: number;
  readonly rows: number;
  /** Row-major, 0 = open, 1 = done. */
  readonly cells: readonly number[];
  /** The streak length, digits already localised (the streak label shows it). */
  readonly streakText: string;
};

/** JS thread, pure: the final state of a change, in the shape draw() reads. */
export function toView(state: __SURFACE_PASCAL__State, format: ViewFormat): __SURFACE_PASCAL__View {
  return {
    cols: state.cols,
    rows: state.rows,
    cells: state.cells,
    streakText: format.formatNumber(Math.max(0, state.streakDays)),
  };
}
