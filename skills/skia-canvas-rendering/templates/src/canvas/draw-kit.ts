// src/canvas/draw-kit.ts
// Imports Skia TYPES only and receives the Skia API as a parameter, so the same code runs on device
// (Skia from the package), in Jest goldens (CanvasKit) and in headless Node scripts.
import type { CanvasColors, DrawKit, SkiaApi } from './canvas-types';
import type { SkColor, SkPath, SkTypeface } from '@shopify/react-native-skia';

/** Hex colours (#RRGGBB or #RRGGBBAA) per semantic token. */
export type Palette<TToken extends string> = Readonly<Record<TToken, string>>;

/**
 * Palette sets with identical tokens. Every surface has 'light' and 'dark'; an app that offers a
 * colour-blind or high-contrast setting adds its sets (and lists them in contracts/canvas-surfaces.json).
 */
export type PaletteSet<TToken extends string, TSet extends string = 'light' | 'dark'> = Readonly<
  Record<TSet, Palette<TToken>>
>;

/** PaintStyle.Stroke; a literal so this module needs no value import from Skia. */
const PAINT_STYLE_STROKE = 1;

/** Resolves every token of one set once per palette change; draw() reads `colors.color.<token>`. */
export function makeCanvasColors<TToken extends string, TSet extends string>(
  skia: SkiaApi,
  palettes: PaletteSet<TToken, TSet>,
  set: TSet,
): CanvasColors<TToken> {
  const palette: Readonly<Record<string, string>> = palettes[set];
  const color = Object.fromEntries(
    Object.entries(palette).map(([token, hex]): [string, SkColor] => [token, skia.Color(hex)]),
  ) as Record<TToken, SkColor>;
  return { set, color };
}

export type KitInput = {
  readonly paths: Readonly<Partial<Record<string, SkPath>>>;
  readonly numberTypeface: SkTypeface | null;
  readonly numberSize: number;
};

/** Builds the scratch paints, the number font and the unit paths once per theme, on JS. */
export function makeDrawKit(skia: SkiaApi, input: KitInput): DrawKit {
  const fill = skia.Paint();
  fill.setAntiAlias(true);
  const stroke = skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PAINT_STYLE_STROKE);
  const numberFont =
    input.numberTypeface === null ? null : skia.Font(input.numberTypeface, input.numberSize);
  return { fill, stroke, numberFont, paths: input.paths, labels: {} };
}
