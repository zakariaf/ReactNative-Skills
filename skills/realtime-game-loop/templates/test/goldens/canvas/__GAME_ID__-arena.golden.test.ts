// test/goldens/canvas/__GAME_ID__-arena.golden.test.ts
// PIXEL GOLDEN of a real-time surface (Jest 'golden' project, CanvasKit): the SAME drawArena() the
// device runs, on a sim stepped by a scripted bot to fixed ticks, at 3 sizes x 3 moments of the run.
// Tolerance and diff folder come from skia-golden.ts. Create or change baselines only with
// `npx jest <this file> --selectProjects golden -u`, after opening every PNG, and commit them on
// purpose (the golden-and-snapshot-tests skill holds the policy).
import { Skia } from '@shopify/react-native-skia';

import { makeCanvasColors, makeDrawKit } from '@/canvas/draw-kit';
import { paintSimPng } from '@/canvas/realtime/paint-sim-png';
import { CANVAS_PALETTES } from '@/games/__GAME_ID__/canvas/canvas-palettes';
import { drawArena } from '@/games/__GAME_ID__/canvas/draw-arena';
import {
  create__GAME_PASCAL__Sim,
  step__GAME_PASCAL__Sim,
} from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';
import { toMatchPixelGolden } from '@test/goldens/skia-golden';

import type { __GAME_PASCAL__Sim } from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';

expect.extend({ toMatchImageSnapshot: toMatchPixelGolden });

// The arena draws no text, so no typeface is loaded.
const KIT = makeDrawKit(Skia, { paths: {}, numberTypeface: null, numberSize: 16 });
const COLORS = makeCanvasColors(Skia, CANVAS_PALETTES, 'dark');
const SIZES = [
  { name: 'phone-portrait', width: 390, height: 560 },
  { name: 'tablet-landscape', width: 1024, height: 700 },
  { name: 'small', width: 320, height: 400 },
] as const;
/** Moments of the scripted run: 0, 50 % and 100 % of RUN_TICKS (120 ticks = 1 s). */
const MOMENTS = [0, 0.5, 1] as const;
const RUN_TICKS = 240;
const SEED = 7;
const ENTITIES = 20;

/** The same seed and bot always give the same world, so the pictures are stable. */
function simAt(ticks: number): __GAME_PASCAL__Sim {
  const sim = create__GAME_PASCAL__Sim(SEED, ENTITIES);
  for (let tick = 0; tick < ticks; tick += 1) step__GAME_PASCAL__Sim(sim, ((tick >> 5) % 16) + 1);
  return sim;
}

describe('__GAME_ID__ arena goldens', () => {
  it.each(SIZES.flatMap((size) => MOMENTS.map((moment) => ({ ...size, moment }))))(
    'renders $name at $moment of a scripted run',
    ({ width, height, moment, name }) => {
      const png = paintSimPng(Skia, {
        draw: drawArena,
        sim: simAt(Math.round(RUN_TICKS * moment)),
        width,
        height,
        colors: COLORS,
        kit: KIT,
      });
      expect(Buffer.from(png)).toMatchImageSnapshot({
        customSnapshotIdentifier: `__GAME_ID__-arena-${name}-${String(moment)}`,
      });
    },
  );
});
