// src/features/insights/canvas/weekly-chart-surface.ts
import { drawChart } from './draw-chart';
import { layoutChart } from './layout-chart';
import { toView } from './to-view';

import type { WeeklyChartState } from './canvas-model';
import type { CanvasToken } from './canvas-palettes';
import type { WeeklyChartView } from './to-view';
import type { CanvasSurface } from '@/canvas/canvas-types';

export const weeklyChartSurface: CanvasSurface<WeeklyChartState, WeeklyChartView, CanvasToken> = {
  // A time axis: in RTL locales the week reads from the right.
  isMirroredInRtl: true,
  toView,
  layout: layoutChart,
  draw: drawChart,
  // Bars and lines only: no unit paths.
  buildPaths: () => ({}),
  describe: (view) => ({
    id: 'insights.weekly-chart.summary',
    values: {
      doneCount: view.done.reduce((sum, count) => sum + count, 0),
      daysAtGoalCount: view.done.filter((count) => count >= view.goal).length,
    },
  }),
};
