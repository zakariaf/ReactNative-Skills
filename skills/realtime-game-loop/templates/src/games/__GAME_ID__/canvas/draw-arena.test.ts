// src/games/__GAME_ID__/canvas/draw-arena.test.ts
import { ARENA, create__GAME_PASCAL__Sim, MAX_ENTITIES } from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';

import { drawArena } from './draw-arena';

import type { CanvasToken } from './canvas-palettes';
import type { CanvasColors, DrawKit } from '@/canvas/canvas-types';
import type { SkCanvas, SkColor, SkPaint } from '@shopify/react-native-skia';

/** Per-game ceiling of canvas calls on the fullest frame (the app-wide cap is 1000). */
const DRAW_CALL_BUDGET = 100;
/** Float slack for a body that touches the canvas edge exactly. */
const EDGE_EPSILON = 1e-6;

type Circle = { readonly x: number; readonly y: number; readonly r: number };
type Recorded = { readonly calls: string[]; readonly circles: Circle[] };

/** Records every canvas call in order (a headless proxy for draw calls per frame) and the circles. */
function recordingCanvas(): { canvas: SkCanvas; recorded: Recorded } {
  const recorded: Recorded = { calls: [], circles: [] };
  const canvas = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          recorded.calls.push(String(name));
          const [x, y, r] = args;
          if (name === 'drawCircle' && typeof x === 'number' && typeof y === 'number') {
            recorded.circles.push({ x, y, r: typeof r === 'number' ? r : 0 });
          }
        },
    },
  ) as SkCanvas;
  return { canvas, recorded };
}

const stubPaint = new Proxy({}, { get: () => () => undefined }) as SkPaint;
const KIT: DrawKit = { fill: stubPaint, stroke: stubPaint, numberFont: null, paths: {}, labels: {} };
const COLOR = new Float32Array([0, 0, 0, 1]) as SkColor;
const COLORS: CanvasColors<CanvasToken> = {
  set: 'dark',
  color: { background: COLOR, player: COLOR, enemy: COLOR, ring: COLOR },
};
const SIZES = [
  { width: 390, height: 560 },
  { width: 1024, height: 700 },
  { width: 320, height: 400 },
] as const;

describe('drawArena', () => {
  it('stays within the draw-call budget with every entity slot in play', () => {
    const sim = create__GAME_PASCAL__Sim(1, MAX_ENTITIES);
    const { canvas, recorded } = recordingCanvas();
    drawArena(canvas, { sim, width: 390, height: 560, colors: COLORS, kit: KIT });
    expect(recorded.calls.length).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    expect(recorded.circles).toHaveLength(MAX_ENTITIES + 1);
  });

  it('paints every pixel first (the canvas is opaque)', () => {
    const { canvas, recorded } = recordingCanvas();
    drawArena(canvas, { sim: create__GAME_PASCAL__Sim(2, 4), width: 390, height: 560, colors: COLORS, kit: KIT });
    expect(recorded.calls[0]).toBe('drawColor');
  });

  it.each(SIZES)('draws every body whole inside a $width x $height canvas', ({ width, height }) => {
    const sim = create__GAME_PASCAL__Sim(5, 20);
    sim.body[4] = 0; // one body on the arena's corner
    sim.body[5] = ARENA;
    sim.body[0] = ARENA; // the player on the opposite corner
    sim.body[1] = 0;
    const { canvas, recorded } = recordingCanvas();
    drawArena(canvas, { sim, width, height, colors: COLORS, kit: KIT });
    expect(recorded.circles.length).toBeGreaterThan(1);
    for (const { x, y, r } of recorded.circles) {
      expect(x - r).toBeGreaterThanOrEqual(-EDGE_EPSILON);
      expect(x + r).toBeLessThanOrEqual(width + EDGE_EPSILON);
      expect(y - r).toBeGreaterThanOrEqual(-EDGE_EPSILON);
      expect(y + r).toBeLessThanOrEqual(height + EDGE_EPSILON);
    }
  });
});
