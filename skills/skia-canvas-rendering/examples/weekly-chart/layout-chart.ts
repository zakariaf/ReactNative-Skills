// src/features/insights/canvas/layout-chart.ts
'worklet';

import type { WeeklyChartView } from './to-view';
import type { CanvasLayout } from '@/canvas/canvas-layout';
import type { LayoutInput } from '@/canvas/canvas-types';

const PAD = 12;
const DAYS = 7;
/** At least three rows of plot above the label row, so a short canvas still shows bars. */
const MIN_ROWS = 4;

/**
 * Two regions over the same seven columns: 'bars' (the plot, rows of square cells, so a tap
 * anywhere in a column hits that day) and 'labels' (one row of digit slots under it). Mirrored in
 * RTL by cellRect and hitTest: Monday sits on the right.
 */
export function layoutChart(input: LayoutInput<WeeklyChartView>): CanvasLayout {
  const slot = Math.max(
    0,
    Math.floor(Math.min((input.width - 2 * PAD) / DAYS, (input.height - 2 * PAD) / MIN_ROWS)),
  );
  const rows = slot === 0 ? 1 : Math.max(1, Math.floor((input.height - 2 * PAD) / slot) - 1);
  const x = Math.floor((input.width - slot * DAYS) / 2);
  return {
    width: input.width,
    height: input.height,
    isMirrored: input.isMirrored,
    regions: [
      { id: 'bars', x, y: PAD, cell: slot, cols: DAYS, rows },
      { id: 'labels', x, y: PAD + rows * slot, cell: slot, cols: DAYS, rows: 1 },
    ],
  };
}
