// src/ui/adaptive/pane-layout.ts
// Owned by the adaptive-layout skill. The app's breakpoints beyond the window class live here and
// nowhere else: how many panes a list-detail screen shows, and how many columns a grid gets. Both
// are pure functions of the box the content has now (a measured container, or before its first
// layout the window minus the side insets), never of the device model. Pane counts come from what
// fits: two panes only when the list at its width and the detail at its minimum both fit beside a
// hairline divider.
import { STROKE } from '@/theme/tokens';

import type { WindowClass } from '@/hooks/use-window-class';

/** The list pane's width beside a detail pane (Material's list-detail list column, Apple's sidebar). */
export const LIST_PANE_WIDTH = 320;

/** The list pane's width while the text is large: rows wrap less and stay legible. */
export const LIST_PANE_WIDTH_LARGE_TEXT = 400;

/** The narrowest detail pane that still reads as a page, not a column. */
export const DETAIL_PANE_MIN_WIDTH = 400;

export type PaneLayout =
  { readonly kind: 'one-pane' } | { readonly kind: 'two-pane'; readonly listWidth: number };

/** The box the panes share and the window class around it. */
export type PaneSpace = {
  /**
   * The panes' own width with the side insets already off: the measured box (a side tab bar, a
   * permanent drawer or a form sheet makes it narrower than the window), or the window width minus
   * the physical side insets before the first layout.
   */
  readonly width: number;
  readonly windowClass: WindowClass;
};

const ONE_PANE: PaneLayout = { kind: 'one-pane' };

/**
 * One pane on every compact window; on a regular one, two panes when the list and the detail
 * both fit in the box. A regular window is not enough by itself: a half-width iPad Split View pane
 * (about 678 pt) is regular and still gets one pane, an iPad mini beside an 80 pt side rail leaves
 * 664 pt, and large text widens the list.
 */
export function listDetailLayoutOf(space: PaneSpace): PaneLayout {
  if (space.windowClass.width === 'compact') return ONE_PANE;
  const listWidth = space.windowClass.isLargeText ? LIST_PANE_WIDTH_LARGE_TEXT : LIST_PANE_WIDTH;
  return space.width >= listWidth + STROKE.hair + DETAIL_PANE_MIN_WIDTH
    ? { kind: 'two-pane', listWidth }
    : ONE_PANE;
}

export type GridSpace = {
  /** The measured width of the grid's own container (onLayout), never the window's. */
  readonly width: number;
  readonly minCellWidth: number;
  readonly gap: number;
  readonly maxColumns: number;
};

/** As many columns of at least minCellWidth as fit, between 1 and maxColumns. */
export function gridColumnsOf(space: GridSpace): number {
  const fitting = Math.floor((space.width + space.gap) / (space.minCellWidth + space.gap));
  return Math.min(space.maxColumns, Math.max(1, fitting));
}

export type GridCells = {
  /** The width the cells share (the measured container minus its padding). */
  readonly width: number;
  readonly gap: number;
  /** From gridColumnsOf on the same width. */
  readonly columns: number;
};

/**
 * Each cell's width when `columns` cells and their gaps share `width`, floored to whole points so a
 * row never wraps. Every cell gets it, so a short last row keeps the grid's cell size instead of
 * stretching across the row (which `flex: 1` would do).
 */
export function gridCellWidthOf(grid: GridCells): number {
  return Math.floor((grid.width - grid.gap * (grid.columns - 1)) / grid.columns);
}
