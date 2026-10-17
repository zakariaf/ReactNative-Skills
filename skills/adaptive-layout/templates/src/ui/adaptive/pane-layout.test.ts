// src/ui/adaptive/pane-layout.test.ts
// no-providers: pure layout maths over plain numbers, no React and no context.
import { classifyWindow } from '@/hooks/use-window-class';

import {
  DETAIL_PANE_MIN_WIDTH,
  LIST_PANE_WIDTH,
  LIST_PANE_WIDTH_LARGE_TEXT,
  gridCellWidthOf,
  gridColumnsOf,
  listDetailLayoutOf,
} from './pane-layout';

/** The window table: every adaptive layout is proven at these sizes (pt / dp). */
const WINDOWS = [
  { name: 'a narrow split-screen pane', width: 320, height: 568, side: 0, normal: 1, large: 1 },
  { name: 'a compact Android phone', width: 360, height: 800, side: 0, normal: 1, large: 1 },
  { name: 'a phone in portrait', width: 402, height: 874, side: 0, normal: 1, large: 1 },
  { name: 'a phone in landscape', width: 874, height: 402, side: 62, normal: 2, large: 1 },
  { name: 'a half-width iPad Split View', width: 678, height: 1032, side: 0, normal: 1, large: 1 },
  { name: 'an iPad mini in portrait', width: 744, height: 1133, side: 0, normal: 2, large: 1 },
  { name: 'an Android tablet in portrait', width: 800, height: 1280, side: 0, normal: 2, large: 1 },
  { name: 'a 13-inch iPad in landscape', width: 1376, height: 1032, side: 0, normal: 2, large: 2 },
] as const;

/** The panes span the window here: their box is the window minus both side insets. */
function panesAt(window: (typeof WINDOWS)[number], fontScale: number): number {
  const layout = listDetailLayoutOf({
    width: window.width - 2 * window.side,
    windowClass: classifyWindow(window.width, window.height, fontScale),
  });
  return layout.kind === 'two-pane' ? 2 : 1;
}

describe('listDetailLayoutOf', () => {
  it.each(WINDOWS)('shows $normal pane(s) on $name ($width x $height)', (window) => {
    expect(panesAt(window, 1)).toBe(window.normal);
  });

  it.each(WINDOWS)('shows $large pane(s) on $name at fontScale 2', (window) => {
    expect(panesAt(window, 2)).toBe(window.large);
  });

  it('widens the list pane while the text is large', () => {
    const regular = classifyWindow(1376, 1032, 1);
    const large = classifyWindow(1376, 1032, 2);
    const space = { width: 1376 };
    expect(listDetailLayoutOf({ ...space, windowClass: regular })).toStrictEqual({
      kind: 'two-pane',
      listWidth: LIST_PANE_WIDTH,
    });
    expect(listDetailLayoutOf({ ...space, windowClass: large })).toStrictEqual({
      kind: 'two-pane',
      listWidth: LIST_PANE_WIDTH_LARGE_TEXT,
    });
  });

  it('splits exactly when the list, the divider and the detail minimum fit', () => {
    const fits = LIST_PANE_WIDTH + 1 + DETAIL_PANE_MIN_WIDTH;
    const at = (width: number): string =>
      listDetailLayoutOf({ width, windowClass: classifyWindow(width, 1000, 1) }).kind;
    expect(at(fits)).toBe('two-pane');
    expect(at(fits - 1)).toBe('one-pane');
  });

  it('decides from the box, not the window, beside a side rail or in a sheet', () => {
    const miniPortrait = classifyWindow(744, 1133, 1);
    expect(listDetailLayoutOf({ width: 744, windowClass: miniPortrait }).kind).toBe('two-pane');
    // An 80 pt side tab bar leaves 664 pt: the detail would get 343 pt, below its minimum.
    expect(listDetailLayoutOf({ width: 664, windowClass: miniPortrait }).kind).toBe('one-pane');
    // A form sheet about 700 pt wide inside a 13-inch iPad window.
    const fullIpad = classifyWindow(1376, 1032, 1);
    expect(listDetailLayoutOf({ width: 700, windowClass: fullIpad }).kind).toBe('one-pane');
  });
});

describe('gridColumnsOf', () => {
  it.each([
    { width: 288, columns: 1 },
    { width: 340, columns: 2 },
    { width: 520, columns: 3 },
    { width: 1055, columns: 6 },
    { width: 2000, columns: 6 },
  ])('fits $columns column(s) of 160 in $width', ({ width, columns }) => {
    expect(gridColumnsOf({ width, minCellWidth: 160, gap: 12, maxColumns: 6 })).toBe(columns);
  });

  it('keeps one column when even one cell does not fit', () => {
    expect(gridColumnsOf({ width: 100, minCellWidth: 160, gap: 12, maxColumns: 4 })).toBe(1);
  });
});

describe('gridCellWidthOf', () => {
  it.each([
    { width: 264, columns: 1, cell: 264 },
    { width: 356, columns: 2, cell: 172 },
    { width: 1031, columns: 4, cell: 248 },
  ])('gives $columns column(s) in $width cells of $cell', ({ width, columns, cell }) => {
    expect(gridCellWidthOf({ width, gap: 12, columns })).toBe(cell);
  });

  it('keeps every row of cells and gaps within the width', () => {
    for (let width = 160; width <= 1400; width += 7) {
      const columns = gridColumnsOf({ width, minCellWidth: 160, gap: 12, maxColumns: 6 });
      const cell = gridCellWidthOf({ width, gap: 12, columns });
      expect(cell * columns + 12 * (columns - 1)).toBeLessThanOrEqual(width);
      expect(cell).toBeGreaterThanOrEqual(160);
    }
  });
});
