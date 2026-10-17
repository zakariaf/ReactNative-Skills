// src/canvas/draw-text.test.ts
import { drawCenteredText, drawFittedText, fittedScale, textWidth } from './draw-text';

import type { SkCanvas, SkFont, SkPaint } from '@shopify/react-native-skia';

/** A 16 pt font whose every glyph is 8 pt wide (the Skia font API as the helpers use it). */
function stubFont(glyphWidth = 8, size = 16): SkFont {
  return {
    getSize: () => size,
    // One glyph per UTF-16 unit is enough for the digits these tests draw.
    getGlyphIDs: (text: string) => Array.from({ length: text.length }, (_, index) => index + 1),
    getGlyphWidths: (ids: readonly number[]) => ids.map(() => glyphWidth),
  } as unknown as SkFont;
}

const PAINT = {} as SkPaint;

/** Records every canvas call with its arguments. */
function recordingCanvas(): { canvas: SkCanvas; calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const canvas = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          calls.push([String(name), ...args]);
        },
    },
  ) as SkCanvas;
  return { canvas, calls };
}

describe('textWidth', () => {
  it('adds the glyph widths (SkFont.measureText does not exist in CanvasKit)', () => {
    expect(textWidth(stubFont(), '۱۲')).toBe(16);
  });
});

describe('drawCenteredText', () => {
  it('centres the run on cx at the baseline', () => {
    const { canvas, calls } = recordingCanvas();
    const font = stubFont();
    drawCenteredText(canvas, { text: '12', cx: 50, y: 30 }, { font, paint: PAINT });
    expect(calls).toStrictEqual([['drawText', '12', 42, 30, PAINT, font]]);
  });
});

describe('fittedScale', () => {
  it('keeps the kit size when the text already fits', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(fittedScale(stubFont(), { text: '7', rect })).toBe(1);
  });

  it('shrinks to the height share of a flat shape (a badge)', () => {
    const rect = { x: 0, y: 0, width: 40, height: 10 };
    // 0.8 of 10 pt tall over a 16 pt font.
    expect(fittedScale(stubFont(), { text: '7', rect })).toBeCloseTo(0.5);
  });

  it('shrinks to the width share for long numbers, with a custom share', () => {
    const rect = { x: 0, y: 0, width: 20, height: 100 };
    // 0.5 of 20 pt wide over three 8 pt glyphs.
    expect(fittedScale(stubFont(), { text: '123', rect, maxShare: 0.5 })).toBeCloseTo(10 / 24);
  });
});

describe('drawFittedText', () => {
  it('draws the digits centred in the rect at the fitted scale', () => {
    const { canvas, calls } = recordingCanvas();
    const font = stubFont();
    const rect = { x: 10, y: 20, width: 40, height: 10 };
    drawFittedText(canvas, { text: '9', rect }, { font, paint: PAINT });
    expect(calls.map(([name]) => name)).toStrictEqual([
      'save',
      'translate',
      'scale',
      'drawText',
      'restore',
    ]);
    expect(calls[1]).toStrictEqual(['translate', 30, 25 + 16 * 0.5 * 0.36]);
    expect(calls[2]).toStrictEqual(['scale', 0.5, 0.5]);
    expect(calls[3]).toStrictEqual(['drawText', '9', -4, 0, PAINT, font]);
  });

  it('draws nothing into an empty rect', () => {
    const { canvas, calls } = recordingCanvas();
    const rect = { x: 0, y: 0, width: 0, height: 0 };
    drawFittedText(canvas, { text: '9', rect }, { font: stubFont(), paint: PAINT });
    expect(calls).toStrictEqual([]);
  });
});
