// src/theme/fonts.ts
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
 * The default is the system font everywhere (contracts/design-system.json says "fonts": "system"):
 * nothing to download, embed, pin or license. Bundling is an opt-in for a design that names a
 * typeface: name a family per weight here (one file per weight, file name = PostScript name, e.g.
 * latin: { regular: 'NotoSans-Regular', medium: 'NotoSans-Regular', semibold: 'NotoSans-Bold',
 * bold: 'NotoSans-Bold' }), replace the contract's "system" with the files, their sha256 and
 * licences, add the expo-font plugin entry, and add each tall script's hhea metrics below
 * (references/text-and-fonts.md, "Fonts"). check-design-system then holds every file to its pin.
 */
export const SCRIPT_FONTS: Readonly<Record<ScriptKey, ScriptFamilies | null>> = {
  latin: null,
  arabic: null,
};

/**
 * An optional display typeface per script, for a design that names one beside its text face (a
 * Latin display family for headings, numbers and the brand name). Display and brand text draw with
 * it; a script without an entry draws its display text with its SCRIPT_FONTS family. It is bundled
 * and pinned exactly like SCRIPT_FONTS: one file per weight, file name = PostScript name, each file
 * in the contract and the expo-font entry, metrics in TALL_SCRIPT_METRICS for a tall script. The
 * default names none; a Latin display face reads latin: { regular: 'Fraunces-Bold', medium:
 * 'Fraunces-Bold', semibold: 'Fraunces-Bold', bold: 'Fraunces-Bold' } (display text is bold).
 */
export const DISPLAY_FONTS: Readonly<Partial<Record<ScriptKey, ScriptFamilies>>> = {};

/** What scriptFontFor picks from: the family per script and weight, and the display faces. */
export type FontTables = {
  readonly scripts: Readonly<Record<ScriptKey, ScriptFamilies | null>>;
  readonly display: Readonly<Partial<Record<ScriptKey, ScriptFamilies>>>;
};

const FONT_TABLES: FontTables = { scripts: SCRIPT_FONTS, display: DISPLAY_FONTS };

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
 * check-design-system compares them with the file and prints the right values. AppText's overflow
 * guard derives its pads from them, never from a measured offset. A tall script on the system font
 * has no file to read, so it has no entry and no guard; its tall line heights still apply
 * (references/text-and-fonts.md, "System font"). Noto Sans Arabic, for example, is
 * 'NotoSansArabic-Regular': { unitsPerEm: 1000, ascender: 1374, descender: -738 }.
 */
export const TALL_SCRIPT_METRICS: Readonly<Record<string, FontMetrics>> = {};

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
 * list uses its own script). Display text is bold, in the script's display face when DISPLAY_FONTS
 * names one; brand text stays in the Latin family (or the Latin display face) everywhere. `fonts`
 * is the tables, or a SCRIPT_FONTS-shaped table alone (no display faces), as tests pass it.
 */
export function scriptFontFor(
  language: string,
  style: { readonly weight: FontWeightToken; readonly face: TypeFace },
  fonts: FontTables | FontTables['scripts'] = FONT_TABLES,
): ScriptFont {
  const tables: FontTables = 'scripts' in fonts ? fonts : { scripts: fonts, display: {} };
  const script = style.face === 'brand' ? 'latin' : scriptOf(language);
  const resolved = style.face === 'text' ? style.weight : 'bold';
  const display = style.face === 'text' ? undefined : tables.display[script]?.[resolved];
  return {
    fontFamily: display ?? tables.scripts[script]?.[resolved] ?? null,
    fontWeight: FONT_WEIGHT_VALUES[resolved],
    isTallScript: TALL_SCRIPTS.has(script),
  };
}
