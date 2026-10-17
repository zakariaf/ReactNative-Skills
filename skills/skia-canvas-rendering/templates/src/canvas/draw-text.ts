// src/canvas/draw-text.ts
'worklet';

import type { Rect } from './canvas-layout';
import type { SkCanvas, SkFont, SkPaint } from '@shopify/react-native-skia';

/**
 * Width of a run of digits/Latin text. Uses glyph widths because SkFont.measureText is not
 * implemented in Skia's CanvasKit build (returns a jest.fn in Jest, throws in Node headless).
 */
export function textWidth(font: SkFont, text: string): number {
  let width = 0;
  for (const glyphWidth of font.getGlyphWidths(font.getGlyphIDs(text))) width += glyphWidth;
  return width;
}

export type CenteredText = {
  readonly text: string;
  readonly cx: number;
  /** Baseline y. */
  readonly y: number;
};

export type TextStyle = { readonly font: SkFont; readonly paint: SkPaint };

/** Draws already-localised digits (e.g. "۱۲") centred on cx. No shaping: digits and Latin only. */
export function drawCenteredText(canvas: SkCanvas, label: CenteredText, style: TextStyle): void {
  canvas.drawText(
    label.text,
    label.cx - textWidth(style.font, label.text) / 2,
    label.y,
    style.paint,
    style.font,
  );
}

export type FittedText = {
  readonly text: string;
  /** The shape the text must fit (a badge, a small cell): the text is centred in it. */
  readonly rect: Rect;
  /** Largest share of the rect's width and height the text may fill (default 0.8). */
  readonly maxShare?: number;
};

/** Digits sit about this share of the font size above their baseline's centre line. */
const DIGIT_CENTRE = 0.36;

/**
 * The scale (at most 1) that fits the text's measured glyph width and the font's size into
 * maxShare of the rect. Pure, so it is tested without Skia.
 */
export function fittedScale(font: SkFont, label: FittedText): number {
  const share = label.maxShare ?? 0.8;
  const width = textWidth(font, label.text);
  const size = font.getSize();
  const byWidth = width > 0 ? (label.rect.width * share) / width : 1;
  const byHeight = size > 0 ? (label.rect.height * share) / size : 1;
  return Math.max(0, Math.min(1, byWidth, byHeight));
}

/**
 * Draws digits centred in a small shape, shrunk (never grown) so they fill at most maxShare of its
 * width and height: the kit has one number size, and a badge or a small cell is smaller than it.
 */
export function drawFittedText(canvas: SkCanvas, label: FittedText, style: TextStyle): void {
  const scale = fittedScale(style.font, label);
  if (scale <= 0) return;
  const { rect } = label;
  canvas.save();
  canvas.translate(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2 + style.font.getSize() * scale * DIGIT_CENTRE,
  );
  canvas.scale(scale, scale);
  drawCenteredText(canvas, { text: label.text, cx: 0, y: 0 }, style);
  canvas.restore();
}
