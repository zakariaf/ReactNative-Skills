// src/ui/app-text.tsx
import { Platform, Text, View } from 'react-native';

import { TALL_SCRIPT_METRICS } from '@/theme/fonts';
import { typeStyleOf } from '@/theme/type-styles';
import { MAX_FONT_SCALE, useFontScale, useTextStyle } from '@/theme/use-text-style';
import { useTheme } from '@/theme/use-theme';

import { useBalancedWrap } from './use-balanced-wrap';

import type { BalancedWrap } from './use-balanced-wrap';
import type { TextDirection } from '@/theme/text-locale';
import type { ColorTokens } from '@/theme/theme-types';
import type { TypeFace } from '@/theme/tokens';
import type { TypeVariant } from '@/theme/type-styles';
import type { TextAlignToken } from '@/theme/use-text-style';
import type { ReactNode } from 'react';
import type { TextProps, TextStyle } from 'react-native';

export type TextTone = 'default' | 'muted' | 'onPrimary' | 'danger' | 'success' | 'warning';

export type AppTextProps = {
  /** Always the output of t(), a formatter, or an autonym: never a literal (lint: jsx-no-literals). */
  readonly children: string;
  /** A type role (display, title, heading, body, label, caption, number) or a component style. */
  readonly variant?: TypeVariant;
  readonly tone?: TextTone;
  readonly align?: TextAlignToken;
  /** Only for text in another language than the UI (an autonym in a language list). */
  readonly language?: string;
  /**
   * A whole text in the other direction than the UI language's. iOS reads writingDirection;
   * Android ignores it (React Native types it iOS-only), so there the text starts with a direction
   * mark instead.
   */
  readonly direction?: TextDirection;
  readonly numberOfLines?: number;
  readonly isHeader?: boolean;
  readonly testID?: string;
  /** Called after each text layout with its line count. */
  readonly onLineCount?: (lines: number) => void;
};

const TONE_FIELD = {
  default: 'text',
  muted: 'textMuted',
  onPrimary: 'onPrimary',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
} as const satisfies Readonly<Record<TextTone, keyof ColorTokens>>;

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };
/** First-strong isolate and pop (U+2068, U+2069): the brand name keeps its order in RTL text. */
const FSI = '\u2068';
const PDI = '\u2069';
/**
 * Right-to-left and left-to-right marks (U+200F, U+200E). Android picks a paragraph's direction from
 * its first strong character (StaticLayout's FIRSTSTRONG_LTR) and skips what sits inside isolates, so
 * an isolate cannot set it: a leading mark can. Screen readers do not speak the marks.
 */
const DIRECTION_MARK = {
  rtl: '\u200F',
  ltr: '\u200E',
} as const satisfies Readonly<Record<TextDirection, string>>;

type OverflowGuard = {
  readonly paddingTop: number;
  readonly paddingBottom: number;
  readonly marginVertical: number;
};

/** Below this half overflow (pt) a tall-script line renders untouched. */
const MIN_SHIFT = 1.5;

/**
 * A tall-script family's content box at a drawn size (the style's size times the font scale): its
 * rounded hhea ascent plus its rounded descent.
 */
export function contentHeightOf(family: string, fontSize: number): number | null {
  const metrics = TALL_SCRIPT_METRICS[family];
  if (metrics === undefined) return null;
  const em = fontSize / metrics.unitsPerEm;
  return Math.round(metrics.ascender * em) + Math.round(Math.abs(metrics.descender) * em);
}

/**
 * The pads that let a tall-script line keep its line box without clipping its ink, from the drawn
 * content box and the drawn line height (both already multiplied by the font scale). iOS lays all
 * of the overflow above the line and clips the Text at its frame, so tall glyphs lose their tops
 * and the line sits high: there the text moves down by half the overflow. Android (React Native's
 * CSS-like half-leading) already centres it, so there the pads only make the frame hold the ink.
 * Negative margins cancel the pads, so the element still takes the design's line box.
 */
export function overflowGuardOf(
  content: number,
  lineHeight: number,
  os: string,
): OverflowGuard | null {
  const half = (content - lineHeight) / 2;
  if (half < MIN_SHIFT) return null;
  const margin = Math.ceil(half);
  const shift = os === 'ios' ? half : 0;
  return { paddingTop: margin + shift, paddingBottom: margin - shift, marginVertical: -margin };
}

/**
 * React Native draws fontSize and lineHeight times the font scale (iOS RCTAttributedTextUtils,
 * Android sp units) but leaves padding and margin in points, so the guard is computed on the drawn
 * sizes: at 200 % text a guard from the unscaled sizes covers about half the overflow.
 */
function guardFor(style: TextStyle, fontScale: number): OverflowGuard | null {
  const content = contentHeightOf(style.fontFamily ?? '', (style.fontSize ?? 0) * fontScale);
  if (content === null) return null;
  return overflowGuardOf(content, (style.lineHeight ?? 0) * fontScale, Platform.OS);
}

/** The string as drawn: the brand name isolated, and on Android a mark for an explicit direction. */
function shownText(props: AppTextProps, face: TypeFace, os: string): string {
  const text = face === 'brand' ? `${FSI}${props.children}${PDI}` : props.children;
  return props.direction !== undefined && os === 'android'
    ? `${DIRECTION_MARK[props.direction]}${text}`
    : text;
}

function textProps(props: AppTextProps, shouldCarryTestId: boolean): TextProps {
  return {
    ...(props.language === undefined ? {} : { accessibilityLanguage: props.language }),
    ...(props.numberOfLines === undefined ? {} : { numberOfLines: props.numberOfLines }),
    ...(props.isHeader === true ? { accessibilityRole: 'header' as const } : {}),
    ...(shouldCarryTestId && props.testID !== undefined ? { testID: props.testID } : {}),
  };
}

function layoutProps(balance: BalancedWrap, onLineCount?: (lines: number) => void): TextProps {
  const onTextLayout: TextProps['onTextLayout'] =
    onLineCount === undefined
      ? balance.onTextLayout
      : (event) => {
          balance.onTextLayout?.(event);
          onLineCount(event.nativeEvent.lines.length);
        };
  return {
    ...(balance.onLayout === undefined ? {} : { onLayout: balance.onLayout }),
    ...(onTextLayout === undefined ? {} : { onTextLayout }),
  };
}

/** The only component that renders text: role or style, script font, pixel-grid lines, 200% cap. */
export function AppText(props: AppTextProps): ReactNode {
  const theme = useTheme();
  const fontScale = useFontScale();
  const style = typeStyleOf(props.variant ?? 'body');
  const align = props.align ?? 'start';
  const textStyle = useTextStyle({
    style,
    align,
    ...(props.language === undefined ? {} : { language: props.language }),
    ...(props.direction === undefined ? {} : { direction: props.direction }),
  });
  // Display text wraps balanced (text-wrap: balance); body text stays greedy.
  const balance = useBalancedWrap(style.face === 'display', props.children, align);
  const guard = guardFor(textStyle, fontScale);
  const color = { color: theme.colors[TONE_FIELD[props.tone ?? 'default']] };
  const shown = shownText(props, style.face, Platform.OS);
  const text = (
    <Text
      style={[textStyle, style.isTabular === true && TABULAR, color, balance.style, guard]}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...textProps(props, guard === null)}
      {...layoutProps(balance, props.onLineCount)}
    >
      {shown}
    </Text>
  );
  if (guard === null) return text;
  // The wrapper keeps the design's line box and the testID (E2E tools measure this box).
  return <View {...(props.testID === undefined ? {} : { testID: props.testID })}>{text}</View>;
}
