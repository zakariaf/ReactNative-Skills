// src/theme/theme-context.ts
import { createContext } from 'react';

import { PALETTE } from './palette';
import { createThemeSet, selectTheme } from './theme-set';

import type { Theme } from './theme-types';

/** The app's themes, built once from its palette. */
export const APP_THEMES = createThemeSet(PALETTE);

/**
 * The default is the app's own light theme (so a component test renders without a provider). The
 * root layout mounts AppThemeProvider, which follows the setting and the phone; check-design-system
 * fails when no runtime file mounts it (theme-provider-mounted). Components read the theme through
 * useTheme or makeStyles, never APP_THEMES or the palette (check-raw-values: no-palette-import).
 */
export const ThemeContext = createContext<Theme>(
  selectTheme(APP_THEMES, { scheme: 'light', mode: 'standard' }),
);
