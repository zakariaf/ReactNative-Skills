// src/features/tasks/canvas/canvas-model.ts
// Stand-in for skia-canvas-rendering's template surface model (the Tasks progress grid).
export type DayCell = 0 | 1;

export type ProgressGridState = {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly DayCell[];
  readonly streakDays: number;
};

export type ProgressGridAction = { readonly kind: 'toggle-day'; readonly cell: number };
