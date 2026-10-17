// src/theme/navigation-theme.tsx
// The navigation theme built from the app theme. Expo Router's Stack and Tabs (React Navigation
// underneath) paint headers, the tab bar and the screen container from the navigation
// ThemeProvider, not from the app's theme: without this mapping the app turns dark while its
// headers and screen backgrounds stay light. Mount NavigationThemeProvider once, inside
// AppThemeProvider, around the root Stack (check-design-system: navigation-theme-mapped). With React
// Navigation's static API instead of Expo Router, import the same names from
// '@react-navigation/native' and pass toNavigationTheme(theme) to <Navigation theme={...} />.
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';

import { useTheme } from './use-theme';

import type { Theme } from './theme-types';
import type { Theme as NavigationTheme } from 'expo-router';
import type { ReactNode } from 'react';

/** Every navigation colour from a semantic role; fonts stay the platform's unless the app maps them. */
export function toNavigationTheme(theme: Theme): NavigationTheme {
  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.separator,
      notification: theme.colors.danger,
    },
  };
}

export type NavigationThemeProviderProps = { readonly children: ReactNode };

/** Mounted inside AppThemeProvider, around the root Stack; follows every theme switch. */
export function NavigationThemeProvider(props: NavigationThemeProviderProps): ReactNode {
  const theme = useTheme();
  return <ThemeProvider value={toNavigationTheme(theme)}>{props.children}</ThemeProvider>;
}
