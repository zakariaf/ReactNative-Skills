// src/theme/fonts.ts
// (fixture base) The bundled-font variant of the template: Noto Sans and Noto Sans Arabic, stub files
// in assets/fonts with the real hhea metrics and PostScript names, pinned in contracts/design-system.json.
import type { FontWeightToken, TypeFace } from './tokens';

/** The scripts the app's locales use. Add one per script family the app bundles. */
export type ScriptKey = 'latin' | 'arabic';

/**
 * One bundled family per weight. Each string is the font file's base name AND its PostScript name
 * (check-design-system reads the name table): Android finds a bundled font by its file name, iOS by
 * the name inside the file, so only that convention makes one string work on both. Never combine
 * these families with fontWeight: each one is a single face, so the family is the weight.
 */
export type ScriptFamilies = Readonly<Record<FontWeightToken, string>>;

/**
 * Font family per script and weight, or null for the platform's system font (San Francisco on iOS,
 * Roboto on Android, and their fallbacks for other scripts), whose weight comes from fontWeight.
 * The demo bundles two Noto Sans weights, so medium shares the regular file and semibold the bold
 * one: bundle the real face and point the weight at it when the design uses it.
 */
export const SCRIPT_FONTS: Readonly<Record<ScriptKey, ScriptFamilies | null>> = {
  latin: {
    regular: 'NotoSans-Regular',
    medium: 'NotoSans-Regular',
    semibold: 'NotoSans-Bold',
    bold: 'NotoSans-Bold',
  },
  arabic: {
    regular: 'NotoSansArabic-Regular',
    medium: 'NotoSansArabic-Regular',
    semibold: 'NotoSansArabic-Bold',
    bold: 'NotoSansArabic-Bold',
  },
};

/** fontWeight for the system font (never for a bundled family). */
export type FontWeightValue = '400' | '500' | '600' | '700';
export const FONT_WEIGHT_VALUES: Readonly<Record<FontWeightToken, FontWeightValue>> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

/** Languages whose text uses another script than Latin (BCP 47 language subtag -> script). */
export const LANGUAGE_SCRIPTS: Readonly<Record<string, ScriptKey>> = {
  ar: 'arabic',
  fa: 'arabic',
  ur: 'arabic',
};

/** Scripts whose glyphs reach above and below a Latin line box: they take the tall ratios. */
export const TALL_SCRIPTS: ReadonlySet<ScriptKey> = new Set<ScriptKey>(['arabic']);

export type FontMetrics = {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
};

/**
 * hhea metrics (font units) of every bundled tall-script family, read from the TTF:
 * check-design-system compares them with the file. AppText's overflow guard derives its pads from
 * them, never from a measured offset. A tall script on the system font has no file to read, so it
 * has no entry and no guard (references/text-and-fonts.md, "System font").
 */
export const TALL_SCRIPT_METRICS: Readonly<Record<string, FontMetrics>> = {
  'NotoSansArabic-Regular': { unitsPerEm: 1000, ascender: 1374, descender: -738 },
  'NotoSansArabic-Bold': { unitsPerEm: 1000, ascender: 1374, descender: -738 },
};

/** A bundled family (fontFamily set), or the system font (fontFamily null, weight by fontWeight). */
export type ScriptFont = {
  readonly fontFamily: string | null;
  readonly fontWeight: FontWeightValue;
  readonly isTallScript: boolean;
};

/** The script of a BCP 47 tag ('ar-EG' -> arabic); Latin when the app lists no other. */
export function scriptOf(language: string): ScriptKey {
  const subtag = language.split('-')[0]?.toLowerCase() ?? '';
  return LANGUAGE_SCRIPTS[subtag] ?? 'latin';
}

/**
 * The font for a text: it follows the language of the TEXT, not the UI (an autonym in a language
 * list uses its own script). Display text is bold; brand text stays in the Latin family everywhere.
 */
export function scriptFontFor(
  language: string,
  style: { readonly weight: FontWeightToken; readonly face: TypeFace },
  fonts: Readonly<Record<ScriptKey, ScriptFamilies | null>> = SCRIPT_FONTS,
): ScriptFont {
  const script = style.face === 'brand' ? 'latin' : scriptOf(language);
  const resolved = style.face === 'text' ? style.weight : 'bold';
  return {
    fontFamily: fonts[script]?.[resolved] ?? null,
    fontWeight: FONT_WEIGHT_VALUES[resolved],
    isTallScript: TALL_SCRIPTS.has(script),
  };
}
