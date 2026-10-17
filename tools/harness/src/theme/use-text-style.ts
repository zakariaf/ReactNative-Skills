// src/theme/use-text-style.ts
import { PixelRatio, useWindowDimensions } from 'react-native';

import { scriptFontFor } from './fonts';
import { snapToGrid } from './type-styles';
import { useTextLocale } from './use-text-locale';

import type { ScriptFont } from './fonts';
import type { TextDirection } from './text-locale';
import type { TypeStyle } from './tokens';
import type { TextStyle } from 'react-native';

export type TextAlignToken = 'start' | 'center' | 'end';

// React Native swaps 'left' and 'right' in a right-to-left layout (doLeftAndRightSwapInRTL), so
// 'left' means start. Every text sets one explicitly: the default 'auto' follows the text's own
// script, which puts an English word in an Arabic row at the wrong edge.
export const TEXT_ALIGN = { start: 'left', center: 'center', end: 'right' } as const;

/** Text grows with the system setting up to 200 % (WCAG 1.4.4); AppText passes it as maxFontSizeMultiplier. */
export const MAX_FONT_SCALE = 2;

export type TextStyleOptions = {
  readonly style: TypeStyle;
  readonly align: TextAlignToken;
  /** Only for text in another language than the UI (an autonym in a language list). */
  readonly language?: string;
  /**
   * A whole text in the other direction than the UI language's; default: that language's text
   * direction (TextLocale.direction). Becomes writingDirection, which only iOS reads (React Native
   * 0.86 types it in TextStyleIOS); AppText adds a direction mark for Android.
   */
  readonly direction?: TextDirection;
};

/**
 * A length on this device's pixel grid. React Native rounds every measured text box up to whole
 * pixels, so a fractional line height (17 x 1.32 = 22.44) grew each line by up to a third of a
 * point and whole points (26 for 25.5) by up to half a point; on the grid a text box is exactly
 * lines x lineHeight. At 3x: 18.2 -> 55/3, 22.44 -> 67/3, 25.5 -> 77/3.
 */
export function snapToPixels(points: number): number {
  return snapToGrid(points, PixelRatio.get());
}

/**
 * The system font scale React Native applies to text, capped where AppText caps it. It follows a
 * change of the setting while the app runs (useWindowDimensions re-renders on it).
 */
export function useFontScale(): number {
  return Math.min(useWindowDimensions().fontScale, MAX_FONT_SCALE);
}

/** A bundled family names the face (never with fontWeight); the system font takes fontWeight. */
export function fontStyleOf(font: ScriptFont): TextStyle {
  return font.fontFamily === null
    ? { fontWeight: font.fontWeight }
    : { fontFamily: font.fontFamily };
}

/** Font, size, line height on the pixel grid, tracking, direction and alignment of one text. */
export function useTextStyle(options: TextStyleOptions): TextStyle {
  const locale = useTextLocale();
  const fontScale = useFontScale();
  const { style } = options;
  const font = scriptFontFor(options.language ?? locale.language, style);
  const ratio = font.isTallScript ? style.lineHeight.tall : style.lineHeight.base;
  // Connected scripts break apart when tracked: tracking applies to Latin-like scripts only.
  const tracking = font.isTallScript ? 0 : (style.letterSpacingEm ?? 0);
  return {
    ...fontStyleOf(font),
    fontSize: style.fontSize,
    // React Native multiplies lineHeight by the font scale (iOS RCTAttributedTextUtils, Android sp
    // units), so the scaled box is what must land on the grid. Never Math.round to whole points,
    // and never nudge glyphs with padding or translateY here.
    lineHeight: snapToPixels(style.fontSize * ratio * fontScale) / fontScale,
    ...(tracking === 0 ? {} : { letterSpacing: style.fontSize * tracking }),
    writingDirection: options.direction ?? locale.direction,
    textAlign: TEXT_ALIGN[options.align],
  };
}
