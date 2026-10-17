// src/features/insights/canvas/canvas-model.ts
// A second, different surface: a bar chart of tasks done per day this week, fed by the server
// (a TanStack Query result). Where the progress-grid template turns cells over, this one tweens
// visible bars (a held `from` is right for them), flashes the bar that changed (an effect: only
// while its track plays), mirrors in RTL (a time axis), and draws localised digits fitted into
// each bar's label slot. Its events come from diffEvents(previous, next), not from a reducer.

export type WeeklyChartState = {
  /** The Monday of the week, as a date key ('2026-09-28'): a new key means a new week. */
  readonly weekOf: string;
  /** Tasks done per day, Monday first (7 entries). */
  readonly done: readonly number[];
  /** The daily goal the goal line marks. */
  readonly goal: number;
};

export type WeeklyChartEvent =
  /** One day's count changed (a task completed or undone, here or on another device). */
  | {
      readonly kind: 'day-updated';
      readonly day: number;
      readonly from: number;
      readonly to: number;
    }
  /** A new week began: every bar falls from last week's value to zero. */
  | { readonly kind: 'week-started'; readonly previous: readonly number[] };
