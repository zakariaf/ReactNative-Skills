// test/goldens/canvas/__SURFACE__.golden.test.ts
// PIXEL GOLDEN (Jest 'golden' project, CanvasKit). It renders the surface through paintSurfacePng,
// the same draw() and layout() the device runs, at 3 sizes x 3 moments of the busiest change.
// Tolerance and diff folder come from skia-golden.ts. Create or change the baselines only with
// `npx jest <this file> --selectProjects golden -u`, after opening every PNG, and commit them on
// purpose (the golden-and-snapshot-tests skill holds the policy).
import { Skia } from '@shopify/react-native-skia';

import { makeCanvasColors, makeDrawKit } from '@/canvas/draw-kit';
import { paintSurfacePng } from '@/canvas/paint-surface-png';
import { timelineEndMs } from '@/canvas/timeline/track';
import { buildTimeline } from '@/features/__FEATURE__/canvas/build-timeline';
import { CANVAS_PALETTES } from '@/features/__FEATURE__/canvas/canvas-palettes';
import { __SURFACE_CAMEL__Surface } from '@/features/__FEATURE__/canvas/__SURFACE__-surface';
import { toMatchPixelGolden } from '@test/goldens/skia-golden';

import type { __SURFACE_PASCAL__Event } from '@/features/__FEATURE__/canvas/canvas-model';
import type { __SURFACE_PASCAL__View } from '@/features/__FEATURE__/canvas/to-view';

expect.extend({ toMatchImageSnapshot: toMatchPixelGolden });

// The busiest change draws no text, so no typeface is loaded. A surface whose goldens draw text
// loads its bundled TTF here (CanvasKit has no system fonts; Skia's jest setup mocks useFonts):
// Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBytes(new Uint8Array(readFileSync(path)))).
const KIT = makeDrawKit(Skia, {
  paths: __SURFACE_CAMEL__Surface.buildPaths(Skia),
  numberTypeface: null,
  numberSize: 16,
});
const COLORS = makeCanvasColors(Skia, CANVAS_PALETTES, 'dark');
/** The final view of the busiest change: the last week completed, so every day is done. */
const VIEW: __SURFACE_PASCAL__View = {
  cols: 7,
  rows: 4,
  cells: Array.from({ length: 28 }, () => 1),
  streakText: '12',
};
/** The busiest change: seven days turn over and the grid is complete (glow and burst). */
const EVENTS: readonly __SURFACE_PASCAL__Event[] = [
  { kind: 'cells-toggled', cells: [27, 21, 22, 23, 24, 25, 26] },
  { kind: 'goal-reached' },
];
const TRACKS = buildTimeline(EVENTS, 'full');
const SIZES = [
  { name: 'phone-portrait', width: 390, height: 560 },
  { name: 'tablet-landscape', width: 1024, height: 700 },
  { name: 'small', width: 320, height: 400 },
] as const;
const MOMENTS = [0, 0.5, 1] as const;
const CASES = SIZES.flatMap((size) => MOMENTS.map((moment) => ({ ...size, moment })));

describe('__SURFACE__ goldens', () => {
  it.each(CASES)(
    'renders $name at $moment of the busiest change',
    ({ width, height, moment, name }) => {
      const png = paintSurfacePng(Skia, {
        draw: __SURFACE_CAMEL__Surface.draw,
        layout: __SURFACE_CAMEL__Surface.layout,
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
        customSnapshotIdentifier: `__SURFACE__-${name}-${String(moment)}`,
      });
    },
  );
});
