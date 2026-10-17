// src/theme/theme-set.ts
import type {
  ColorMode,
  ColorScheme,
  Palette,
  SchemeColors,
  Theme,
  ThemePreference,
} from './theme-types';
import type { ColorSchemeName } from 'react-native';

export type ThemeSelector = { readonly scheme: ColorScheme; readonly mode: ColorMode };
export type ThemeSet = ReadonlyMap<string, Theme>;

const SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

function themeKey({ scheme, mode }: ThemeSelector): string {
  return `${mode}.${scheme}`;
}

function addThemes(themes: Map<string, Theme>, mode: ColorMode, colors: SchemeColors): void {
  for (const scheme of SCHEMES) {
    const key = themeKey({ scheme, mode });
    themes.set(key, { key, scheme, mode, colors: colors[scheme] });
  }
}

/**
 * Builds every theme once, at module load, so each Theme object keeps one identity for the life of
 * the app: makeStyles caches its styles per Theme, so a theme switch costs one build per theme.
 */
export function createThemeSet(palette: Palette): ThemeSet {
  const themes = new Map<string, Theme>();
  addThemes(themes, 'standard', palette);
  if (palette.colorBlind !== undefined) addThemes(themes, 'colorBlind', palette.colorBlind);
  return themes;
}

/** A colour-blind request falls back to the standard theme when the palette ships no variant. */
export function selectTheme(themes: ThemeSet, selector: ThemeSelector): Theme {
  const standard = themeKey({ scheme: selector.scheme, mode: 'standard' });
  const theme = themes.get(themeKey(selector)) ?? themes.get(standard);
  if (theme === undefined) throw new Error(`Missing theme ${themeKey(selector)}`);
  return theme;
}

export function resolveColorScheme(
  preference: ThemePreference,
  system: ColorSchemeName | null | undefined,
): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
