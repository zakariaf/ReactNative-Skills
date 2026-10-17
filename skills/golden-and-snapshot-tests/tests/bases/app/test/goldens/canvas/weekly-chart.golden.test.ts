// test/goldens/canvas/weekly-chart.golden.test.ts
// PIXEL GOLDEN (Jest 'golden' project, CanvasKit): the chart's draw() and layout() at 3 sizes x 3
// moments of its busiest change. Baselines change only with -u on this file and a Gate-Change trailer.
import { Skia } from '@shopify/react-native-skia';

import { makeCanvasColors, makeDrawKit } from '@/canvas/draw-kit';
import { paintSurfacePng } from '@/canvas/paint-surface-png';
import { timelineEndMs } from '@/canvas/timeline/track';
import { buildTimeline } from '@/features/insights/canvas/build-timeline';
import { CANVAS_PALETTES } from '@/features/insights/canvas/canvas-palettes';
import { weeklyChartSurface } from '@/features/insights/canvas/weekly-chart-surface';
import { toMatchPixelGolden } from '@test/goldens/skia-golden';

expect.extend({ toMatchImageSnapshot: toMatchPixelGolden });

const KIT = makeDrawKit(Skia, { paths: {}, numberTypeface: null, numberSize: 16 });
const COLORS = makeCanvasColors(Skia, CANVAS_PALETTES, 'dark');
const VIEW = weeklyChartSurface.toView({ done: [3, 2, 5, 4, 4, 0, 6], goal: 4 });
const TRACKS = buildTimeline([{ kind: 'day-rose', day: 6 }], 'full');
const SIZES = [
  { name: 'phone-portrait', width: 390, height: 560 },
  { name: 'tablet-landscape', width: 1024, height: 700 },
  { name: 'small', width: 320, height: 400 },
] as const;
const MOMENTS = [0, 0.5, 1] as const;
const CASES = SIZES.flatMap((size) => MOMENTS.map((moment) => ({ ...size, moment })));

describe('weekly-chart goldens', () => {
  it.each(CASES)('renders $name at $moment of the busiest change', ({ width, height, moment, name }) => {
    const png = paintSurfacePng(Skia, {
      draw: weeklyChartSurface.draw,
      layout: weeklyChartSurface.layout,
      view: VIEW,
      tracks: TRACKS,
      elapsedMs: timelineEndMs(TRACKS) * moment,
      colors: COLORS,
      kit: KIT,
      width,
      height,
      isMirrored: false,
    });
    expect(Buffer.from(png)).toMatchImageSnapshot({
      customSnapshotIdentifier: `weekly-chart-${name}-${String(moment)}`,
    });
  });
});
