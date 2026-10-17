// src/theme/tokens.ts
// Copied from design/tokens.json, never retyped: check-design-system compares every export below
// with its token path (contracts/design-system.json "exports"). Change the token file first.

/** 4-point spacing scale. */
export const SPACING = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Corner radii. */
export const RADII = { sm: 6, md: 10, lg: 16 } as const;
/** Border widths: hairline rules, control edges, emphasised edges. */
export const STROKE = { hair: 1, regular: 2, bold: 3 } as const;
/** Shadow offsets in pt; a sinking key (PRESS.kind sink) sinks by the same amount. */
export const ELEVATION = { flat: 0, raised: 2, control: 4, overlay: 8 } as const;
/**
 * The smallest touch target (Apple 44 pt; Material 48 dp): raise MIN_TOUCH to 48 for a Material
 * design (accessibility-as-code's a11y.minTouchPt), never hitSlop.
 */
export const MIN_TOUCH = 44;
/** Content never grows wider than this; wider windows centre the column. */
export const CONTENT_MAX_WIDTH = 640;

/**
 * How a press answers, one choice for the whole app: 'opacity' dims the face, 'scale' shrinks it a
 * little, 'sink' pushes it into a hard shadow like a key (an opt-in look).
 */
export type PressKind = 'opacity' | 'scale' | 'sink';
export type PressTokens = {
  readonly kind: PressKind;
  /** Android draws the platform ripple instead of dimming or shrinking (a sinking key keeps its sink). */
  readonly androidRipple: boolean;
  /** Face opacity at full press ('opacity', and 'scale' under reduce motion). */
  readonly opacity: number;
  /** Face scale at full press ('scale'). */
  readonly scale: number;
  /** 'sink' only: squash at full depth, scale (1 + x, 1 + y) around the centre; none under reduce motion. */
  readonly squash: { readonly x: number; readonly y: number };
  /** The edge of a disabled control: solid, or dashed (a shape cue on top of the muted paint). */
  readonly disabledEdge: 'solid' | 'dashed';
};
/** The press surface's look and feel (PressableSurface reads it; a keypad may ask for 'sink'). */
export const PRESS: PressTokens = {
  kind: 'opacity',
  androidRipple: true,
  opacity: 0.7,
  scale: 0.97,
  squash: { x: 0.02, y: -0.04 },
  disabledEdge: 'solid',
};

/**
 * The weights a type style may ask for. With bundled fonts each one names a family in fonts.ts (a
 * file per weight); with the system font it becomes fontWeight 400, 500, 600 or 700.
 */
export type FontWeightToken = 'regular' | 'medium' | 'semibold' | 'bold';
/**
 * display: headings and numbers; text: body, labels, captions; brand: the product name, in the Latin
 * family in every language and isolated left to right inside right-to-left text.
 */
export type TypeFace = 'display' | 'text' | 'brand';
/** Line height as a multiple of the font size: Latin-like scripts (base) and tall scripts (tall). */
export type LineHeightRatios = { readonly base: number; readonly tall: number };

export type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'number';
export type TypeStyle = {
  readonly fontSize: number;
  readonly weight: FontWeightToken;
  readonly face: TypeFace;
  readonly lineHeight: LineHeightRatios;
  /** Tracking in em; only type styles track (never a raw letterSpacing in a component). */
  readonly letterSpacingEm?: number;
  /** Numbers that sit in columns or change while visible use tabular figures. */
  readonly isTabular?: boolean;
};

/** Type roles in pt before Dynamic Type / font scale. */
export const TYPE_SCALE: Readonly<Record<TypeRole, TypeStyle>> = {
  display: {
    fontSize: 34,
    weight: 'bold',
    face: 'display',
    lineHeight: { base: 1.15, tall: 1.5 },
  },
  title: { fontSize: 28, weight: 'bold', face: 'display', lineHeight: { base: 1.2, tall: 1.5 } },
  heading: {
    fontSize: 20,
    weight: 'bold',
    face: 'display',
    lineHeight: { base: 1.25, tall: 1.55 },
  },
  body: { fontSize: 17, weight: 'regular', face: 'text', lineHeight: { base: 1.32, tall: 1.5 } },
  label: { fontSize: 17, weight: 'bold', face: 'text', lineHeight: { base: 1.25, tall: 1.5 } },
  caption: {
    fontSize: 13,
    weight: 'regular',
    face: 'text',
    lineHeight: { base: 1.4, tall: 1.6 },
  },
  number: {
    fontSize: 28,
    weight: 'bold',
    face: 'display',
    lineHeight: { base: 1.15, tall: 1.5 },
    isTabular: true,
  },
};
