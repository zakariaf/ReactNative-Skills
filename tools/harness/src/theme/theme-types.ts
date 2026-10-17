// src/theme/theme-types.ts
export type ColorScheme = 'light' | 'dark';
/** What the person chose in the app's settings; 'system' follows the phone. */
export type ThemePreference = 'system' | ColorScheme;
/** 'colorBlind' exists only when the palette ships a colour-blind variant. */
export type ColorMode = 'standard' | 'colorBlind';

/**
 * Semantic colour roles (tier 2). Components read only these; the primitives (tier 1) stay in the
 * token file and never reach app code. Every value is an uppercase #RRGGBB, or #RRGGBBAA for the
 * translucent roles (separator, shadow, scrim), which never take part in a contrast pair.
 */
export type ColorTokens = {
  /** The screen ground behind everything. */
  readonly background: string;
  /** Cards, rows, sheets, dialogs and the face of controls. */
  readonly surface: string;
  /** Inset and empty fills: tracks, disabled controls, pressed rows. */
  readonly sunken: string;
  /** Body text and icons. */
  readonly text: string;
  /** Secondary text, values, placeholders, disabled labels. */
  readonly textMuted: string;
  /** The "go" fill: primary buttons, the selected segment, progress. */
  readonly primary: string;
  /** Text and icons on primary. */
  readonly onPrimary: string;
  /** The edge of a control when it is the control's only boundary (3:1 on the ground). */
  readonly border: string;
  /** Decorative hairlines between rows; translucent, never a control's only boundary. */
  readonly separator: string;
  /** Static and pressed shadows. */
  readonly shadow: string;
  /** The focus indicator (keyboard, switch access, a tapped disabled control). */
  readonly focus: string;
  /** Destructive text, icons and edges; on surface or dangerSurface only. */
  readonly danger: string;
  /** The tint behind destructive content (a delete confirmation, an error note). */
  readonly dangerSurface: string;
  /** Done and saved confirmations. */
  readonly success: string;
  /** Warnings that are not errors (an overdue reminder). */
  readonly warning: string;
  /** Dims the screen under dialogs and sheets. */
  readonly scrim: string;
};

export type SchemeColors = Readonly<Record<ColorScheme, ColorTokens>>;

/** One palette: light and dark, plus an optional colour-blind variant of both. */
export type Palette = SchemeColors & { readonly colorBlind?: SchemeColors };

/** Fonts are not in the theme: AppText picks them from the language of each text. */
export type Theme = {
  readonly key: string;
  readonly scheme: ColorScheme;
  readonly mode: ColorMode;
  readonly colors: ColorTokens;
};
