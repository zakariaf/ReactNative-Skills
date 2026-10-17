// src/features/__FEATURE__/canvas/draw-__SURFACE__.test.ts
import { EMPTY_HIGHLIGHT, IDLE_POINTER } from '@/canvas/canvas-types';
import { sampleTimeline } from '@/canvas/timeline/sample';

import { buildTimeline } from './build-timeline';
import { draw__SURFACE_PASCAL__ } from './draw-__SURFACE__';
import { layout__SURFACE_PASCAL__ } from './layout-__SURFACE__';

import type { __SURFACE_PASCAL__Event } from './canvas-model';
import type { CanvasToken } from './canvas-palettes';
import type { __SURFACE_PASCAL__View } from './to-view';
import type { CanvasColors, CanvasHighlight, DrawKit } from '@/canvas/canvas-types';
import type { Track } from '@/canvas/timeline/track';
import type { SkCanvas, SkColor, SkFont, SkPaint } from '@shopify/react-native-skia';

/** This surface's ceiling of canvas calls on its busiest frame (never above 1000). */
const DRAW_CALL_BUDGET = 250;

type Recorded = {
  readonly calls: Map<string, number>;
  readonly order: string[];
  readonly texts: string[];
};

/** Counts every canvas call (a headless proxy for draw calls per frame), in order, and keeps drawText strings. */
function recordingCanvas(): { canvas: SkCanvas; recorded: Recorded } {
  const recorded: Recorded = { calls: new Map(), order: [], texts: [] };
  const canvas = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          recorded.calls.set(String(name), (recorded.calls.get(String(name)) ?? 0) + 1);
          recorded.order.push(String(name));
          if (name === 'drawText' && typeof args[0] === 'string') recorded.texts.push(args[0]);
        },
    },
  ) as SkCanvas;
  return { canvas, recorded };
}

const stubFont = {
  getSize: () => 16,
  getGlyphIDs: () => [1, 2],
  getGlyphWidths: () => [8, 8],
} as unknown as SkFont;
const stubPaint = new Proxy({}, { get: () => () => undefined }) as SkPaint;
const KIT: DrawKit = {
  fill: stubPaint,
  stroke: stubPaint,
  numberFont: stubFont,
  paths: {},
  labels: {},
};
const COLOR = new Float32Array([0, 0, 0, 1]) as SkColor;
const COLORS: CanvasColors<CanvasToken> = {
  set: 'dark',
  color: {
    background: COLOR,
    cell: COLOR,
    done: COLOR,
    edge: COLOR,
    mark: COLOR,
    glow: COLOR,
    label: COLOR,
    hint: COLOR,
  },
};
/** The final view of the busiest change: the last week completed, so every day is done. */
const VIEW: __SURFACE_PASCAL__View = {
  cols: 7,
  rows: 4,
  cells: Array.from({ length: 28 }, () => 1),
  streakText: '١٢',
};
const BUSIEST: readonly __SURFACE_PASCAL__Event[] = [
  { kind: 'cells-toggled', cells: [27, 21, 22, 23, 24, 25, 26] },
  { kind: 'goal-reached' },
];
const LAYOUT = layout__SURFACE_PASCAL__({ width: 390, height: 560, view: VIEW, isMirrored: false });

type DrawAt = {
  readonly tracks: readonly Track[];
  readonly atMs: number;
  readonly highlight?: CanvasHighlight;
};

function draw(at: DrawAt): Recorded {
  const { canvas, recorded } = recordingCanvas();
  const fx = { ...sampleTimeline(at.tracks, at.atMs), pointer: IDLE_POINTER };
  const highlight = at.highlight ?? EMPTY_HIGHLIGHT;
  draw__SURFACE_PASCAL__(canvas, {
    view: VIEW,
    fx,
    highlight,
    colors: COLORS,
    layout: LAYOUT,
    kit: KIT,
  });
  return recorded;
}

function totalCalls(recorded: Recorded): number {
  return [...recorded.calls.values()].reduce((sum, n) => sum + n, 0);
}

describe('draw__SURFACE_PASCAL__', () => {
  it('paints every pixel first, because SurfaceCanvas is opaque', () => {
    expect(draw({ tracks: [], atMs: 0 }).order[0]).toBe('drawColor');
    expect(draw({ tracks: buildTimeline(BUSIEST, 'full'), atMs: 400 }).order[0]).toBe('drawColor');
  });

  it('stays within the draw-call budget on the busiest frame of a change', () => {
    const recorded = draw({ tracks: buildTimeline(BUSIEST, 'full'), atMs: 400 });
    expect(recorded.calls.get('drawCircle')).toBeGreaterThan(28);
    expect(totalCalls(recorded)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  });

  it('shows at moment 0 no effect that starts later (the glow and the burst wait for their track)', () => {
    const recorded = draw({ tracks: buildTimeline(BUSIEST, 'full'), atMs: 0 });
    // Before the change the seven toggled days still show their old, open face.
    expect(recorded.calls.get('drawCircle')).toBe(21);
    expect(recorded.calls.get('drawRRect')).toBe(28 + 21);
  });

  it('draws the localised streak label while it pops, which a 0.1 % golden could miss', () => {
    const tracks = buildTimeline([{ kind: 'streak-extended', days: 12 }], 'full');
    expect(draw({ tracks, atMs: 0 }).texts).toStrictEqual([]);
    expect(draw({ tracks, atMs: 200 }).texts).toStrictEqual(['١٢']);
  });

  it('rings each hinted day and the selected one', () => {
    const plain = draw({ tracks: [], atMs: 0 });
    const ringed = draw({
      tracks: [],
      atMs: 0,
      highlight: {
        selected: { regionId: 'grid', col: 1, row: 1 },
        hinted: [{ regionId: 'grid', col: 2, row: 2 }],
      },
    });
    expect(ringed.calls.get('drawRRect')).toBe((plain.calls.get('drawRRect') ?? 0) + 2);
  });
});
