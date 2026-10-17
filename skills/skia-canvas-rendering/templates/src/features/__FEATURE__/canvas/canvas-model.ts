// src/features/__FEATURE__/canvas/canvas-model.ts
// The shapes this surface draws. The feature's store computes the state and publishes the events
// of each committed change (past tense, carrying every id the animation needs); the surface never
// goes back to the store to find out what happened.

/** One day of the grid: 0 = open, 1 = every task of that day done. */
export type DayCell = 0 | 1;

export type __SURFACE_PASCAL__State = {
  readonly cols: number;
  readonly rows: number;
  /** Row-major, one per day. */
  readonly cells: readonly DayCell[];
  /** Consecutive days with every task done. */
  readonly streakDays: number;
};

export type __SURFACE_PASCAL__Event =
  /** These days changed state; the day the user acted on comes first. */
  | { readonly kind: 'cells-toggled'; readonly cells: readonly number[] }
  /** Every day of the grid is done. */
  | { readonly kind: 'goal-reached' }
  /** The streak grew. */
  | { readonly kind: 'streak-extended'; readonly days: number };

/** What a tap on a day asks for; a suggestion rings the day it would toggle. */
export type __SURFACE_PASCAL__Action = { readonly kind: 'toggle-day'; readonly cell: number };
