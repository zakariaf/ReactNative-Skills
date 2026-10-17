// test/goldens/canvas/weekly-chart.golden.test.ts
// PIXEL GOLDEN (Jest 'golden' project, CanvasKit): the chart's draw() and layout() at 3 sizes x 3
// moments of its busiest change (three days rise and flash, one day falls). It reads the app's
// bundled TTF with node:fs, so it lives under test/ (Node APIs are not allowed in src/). The example
// ships no baselines: create them with `npx jest <this file> --selectProjects golden -u`, open all
// nine PNGs, and commit them on purpose.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Skia } from '@shopify/react-native-skia';

import { makeCanvasColors, makeDrawKit } from '@/canvas/draw-kit';
import { paintSurfacePng } from '@/canvas/paint-surface-png';
import { timelineEndMs } from '@/canvas/timeline/track';
import { buildTimeline } from '@/features/insights/canvas/build-timeline';
import { CANVAS_PALETTES } from '@/features/insights/canvas/canvas-palettes';
import { diffEvents } from '@/features/insights/canvas/diff-events';
import { weeklyChartSurface } from '@/features/insights/canvas/weekly-chart-surface';
import { toMatchPixelGolden } from '@test/goldens/skia-golden';

import type { WeeklyChartState } from '@/features/insights/canvas/canvas-model';

expect.extend({ toMatchImageSnapshot: toMatchPixelGolden });

// CanvasKit has no system fonts and Skia's Jest setup mocks useFonts, so the golden loads the same
// TTF the device's useFonts provider loads. The typeface goes to makeDrawKit directly: CanvasKit's
// TypefaceFontProvider registers fonts for paragraphs but does not implement matchFamilyStyle.
const FONT = join(process.cwd(), 'assets', 'fonts', 'AppFont-Regular.ttf');
const TYPEFACE = Skia.Typeface.MakeFreeTypeFaceFromData(
  Skia.Data.fromBytes(new Uint8Array(readFileSync(FONT))),
);
const FONTS = Skia.TypefaceFontProvider.Make();
if (TYPEFACE !== null) FONTS.registerFont(TYPEFACE, 'AppFont'); // for paragraph labels (makeLabel)
const KIT = makeDrawKit(Skia, {
  paths: weeklyChartSurface.buildPaths(Skia),
  numberTypeface: TYPEFACE,
  numberSize: 16,
});
const COLORS = makeCanvasColors(Skia, CANVAS_PALETTES, 'light');
/** A refetch on Thursday: Tuesday, Thursday and Sunday rise past the goal, Saturday was undone. */
const BEFORE: WeeklyChartState = { weekOf: '2026-09-28', done: [3, 0, 5, 2, 4, 1, 0], goal: 4 };
const AFTER: WeeklyChartState = { weekOf: '2026-09-28', done: [3, 2, 5, 4, 4, 0, 6], goal: 4 };
const VIEW = weeklyChartSurface.toView(AFTER, { formatNumber: String });
const TRACKS = buildTimeline(diffEvents(BEFORE, AFTER), 'full');
const SIZES = [
  { name: 'phone-portrait', width: 390, height: 300 },
  { name: 'tablet-landscape', width: 1024, height: 520 },
  { name: 'small', width: 320, height: 240 },
] as const;
const MOMENTS = [0, 0.5, 1] as const;
const CASES = SIZES.flatMap((size) => MOMENTS.map((moment) => ({ ...size, moment })));

describe('weekly-chart goldens', () => {
  it('loads the bundled typeface (CanvasKit draws no text without one)', () => {
    expect(TYPEFACE).not.toBeNull();
    expect(KIT.numberFont).not.toBeNull();
  });

  it.each(CASES)(
    'renders $name at $moment of a busy refetch',
    ({ width, height, moment, name }) => {
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
    },
  );
});
