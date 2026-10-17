// src/theme/type-styles.ts
import { TYPE_SCALE } from './tokens';

import type { FontWeightToken, TypeRole, TypeStyle } from './tokens';

/** [base, tall] line-height ratios. */
type Ratios = readonly [number, number];

function display(fontSize: number, [base, tall]: Ratios): TypeStyle {
  return { fontSize, weight: 'bold', face: 'display', lineHeight: { base, tall } };
}

function text(fontSize: number, weight: FontWeightToken, [base, tall]: Ratios): TypeStyle {
  return { fontSize, weight, face: 'text', lineHeight: { base, tall } };
}

/**
 * Component text styles (pt before font scaling), copied from design/tokens.json "type.styles".
 * Components pick one of these or a TYPE_SCALE role, never a raw size. Colour, alignment and
 * wrapping belong to the component.
 */
export const TYPE_STYLES = {
  /** The product name: Latin family in every language, tracked, isolated by AppText. */
  brandName: {
    fontSize: 22,
    weight: 'bold',
    face: 'brand',
    lineHeight: { base: 1.1, tall: 1.1 },
    letterSpacingEm: 0.01,
  },
  screenTitle: display(28, [1.2, 1.5]),
  sectionHeading: display(20, [1.25, 1.55]),
  rowLabel: text(17, 'regular', [1.32, 1.5]),
  /** The row label in bold (a destructive or emphasised row) keeps the row's line heights. */
  rowLabelStrong: text(17, 'bold', [1.32, 1.5]),
  rowDescription: text(14, 'regular', [1.3, 1.5]),
  buttonLabel: text(17, 'bold', [1.25, 1.5]),
  badge: text(12, 'bold', [1.3, 1.45]),
  /** Counts in a summary grid: tabular figures, and a tall box so tall-script digits keep their tops. */
  statValue: { ...display(30, [1.1, 1.45]), isTabular: true },
  statLabel: text(13, 'regular', [1.4, 1.6]),
  toast: text(15, 'regular', [1.35, 1.55]),
} satisfies Readonly<Record<string, TypeStyle>>;

export type TypeStyleName = keyof typeof TYPE_STYLES;
/** Which of a style's two ratios applies: a Latin-like script, or a tall one (Arabic, Devanagari, Thai). */
export type ScriptHeight = 'base' | 'tall';
/** Every name AppText accepts as `variant`: a type role or a component text style. */
export type TypeVariant = TypeRole | TypeStyleName;

const TYPE_VARIANTS: Readonly<Record<TypeVariant, TypeStyle>> = { ...TYPE_SCALE, ...TYPE_STYLES };

export function typeStyleOf(variant: TypeVariant): TypeStyle {
  return TYPE_VARIANTS[variant];
}

/**
 * A length on a device pixel grid: the nearest whole pixel at `pixelRatio` pixels per point. Line
 * heights live on this grid, never on whole points and never as raw fractions: React Native rounds
 * every measured text box up to whole pixels, so 17 x 1.32 = 22.44 grew each line by up to a third
 * of a point and 25.5 rounded to 26 by half a point. At 3x: 18.2 -> 55/3, 22.44 -> 67/3, 25.5 -> 77/3.
 */
export function snapToGrid(points: number, pixelRatio: number): number {
  return Math.round(points * pixelRatio) / pixelRatio;
}

/** The line height AppText gives a role or style, on the pixel grid. */
export function lineHeightOf(
  variant: TypeVariant,
  height: ScriptHeight,
  pixelRatio: number,
): number {
  const style = typeStyleOf(variant);
  return snapToGrid(style.fontSize * style.lineHeight[height], pixelRatio);
}
