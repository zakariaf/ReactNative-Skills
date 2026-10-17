// src/features/insights/canvas/draw-chart.test.ts
import { cellRect } from '@/canvas/canvas-layout';
import { EMPTY_HIGHLIGHT, IDLE_POINTER } from '@/canvas/canvas-types';
import { sampleTimeline } from '@/canvas/timeline/sample';

import { buildTimeline } from './build-timeline';
import { drawChart } from './draw-chart';
import { layoutChart } from './layout-chart';
import { toView } from './to-view';

import type { CanvasToken } from './canvas-palettes';
import type { CanvasColors, CanvasHighlight, DrawKit } from '@/canvas/canvas-types';
import type { Track } from '@/canvas/timeline/track';
import type { SkCanvas, SkColor, SkFont, SkPaint } from '@shopify/react-native-skia';

const DRAW_CALL_BUDGET = 120;

type Recorded = {
  readonly calls: Map<string, number>;
  readonly order: string[];
  readonly texts: string[];
};

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

const font = {
  getSize: () => 16,
  getGlyphIDs: () => [1],
  getGlyphWidths: () => [8],
} as unknown as SkFont;
const paint = new Proxy({}, { get: () => () => undefined }) as SkPaint;
const KIT: DrawKit = { fill: paint, stroke: paint, numberFont: font, paths: {}, labels: {} };
const C = new Float32Array([0, 0, 0, 1]) as SkColor;
const COLORS: CanvasColors<CanvasToken> = {
  set: 'dark',
  color: { background: C, bar: C, goal: C, flash: C, label: C, ring: C },
};
/** A fixed Arabic-Indic formatter (a real Intl.NumberFormat would test the app's Intl data, not the chart). */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ARABIC = {
  formatNumber: (value: number) =>
    String(value).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit),
};
const VIEW = toView({ weekOf: '2026-09-28', done: [3, 0, 5, 2, 4, 1, 6], goal: 4 }, ARABIC);
const LAYOUT = layoutChart({ width: 390, height: 300, view: VIEW, isMirrored: false });
const CHANGE = buildTimeline([{ kind: 'day-updated', day: 2, from: 4, to: 5 }], 'full');

function draw(
  tracks: readonly Track[],
  atMs: number,
  highlight: CanvasHighlight = EMPTY_HIGHLIGHT,
): Recorded {
  const { canvas, recorded } = recordingCanvas();
  const fx = { ...sampleTimeline(tracks, atMs), pointer: IDLE_POINTER };
  drawChart(canvas, { view: VIEW, fx, highlight, colors: COLORS, layout: LAYOUT, kit: KIT });
  return recorded;
}

describe('drawChart', () => {
  it('paints every pixel first, because SurfaceCanvas is opaque', () => {
    expect(draw(CHANGE, 120).order[0]).toBe('drawColor');
  });

  it('stays within its draw-call budget while a bar tweens and flashes', () => {
    const recorded = draw(CHANGE, 120);
    expect(recorded.calls.get('drawRRect')).toBe(6 + 1);
    expect([...recorded.calls.values()].reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(
      DRAW_CALL_BUDGET,
    );
  });

  it('shows no flash at moment 0 (the flash waits for its track; the bar holds its old value)', () => {
    expect(draw(CHANGE, 0).calls.get('drawRRect')).toBe(6);
  });

  it('draws every localised count, which a 0.1 % golden could miss', () => {
    expect(draw([], 0).texts).toStrictEqual(['٣', '٠', '٥', '٢', '٤', '١', '٦']);
  });

  it('rings the selected day', () => {
    const selected = { selected: { regionId: 'bars', col: 2, row: 3 }, hinted: [] };
    expect(draw([], 0, selected).calls.get('drawRRect')).toBe(6 + 1);
  });

  it('puts Monday on the right when mirrored (positions mirror, digits do not)', () => {
    const mirrored = layoutChart({ width: 390, height: 300, view: VIEW, isMirrored: true });
    const monday = cellRect(mirrored, { regionId: 'bars', col: 0, row: 0 });
    expect(monday === null ? 0 : monday.x).toBeGreaterThan(390 / 2);
  });
});
