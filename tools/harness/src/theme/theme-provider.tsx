// src/theme/theme-provider.tsx
import * as SystemUI from 'expo-system-ui';
import { useEffect, useEffectEvent } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import { APP_THEMES, ThemeContext } from './theme-context';
import { resolveColorScheme, selectTheme } from './theme-set';

import type { ThemeSet } from './theme-set';
import type { ThemePreference } from './theme-types';
import type { ReactNode } from 'react';

export type AppThemeProviderProps = {
  /** The saved choice (settings-and-preferences owns the store); 'system' follows the phone. */
  readonly preference: ThemePreference;
  /** Only when the palette ships a colour-blind variant and the person turned it on. */
  readonly isColorBlind?: boolean;
  /** Tests may pass their own set; the app uses the one built from its palette. */
  readonly themes?: ThemeSet;
  /**
   * Receives a failed root-view paint (the root layout passes the error log's record). The paint is
   * cosmetic, so the app goes on with the build-time colour; src/theme never imports src/services.
   */
  readonly onError?: (error: unknown) => void;
  readonly children: ReactNode;
};

/**
 * What Appearance.setColorScheme receives for the saved choice, or null on the web, which has no
 * native UI to follow and no setColorScheme in react-native-web 0.21.3 (calling it throws).
 */
export function appearanceSchemeFor(
  os: string,
  preference: ThemePreference,
): 'light' | 'dark' | 'unspecified' | null {
  if (os === 'web') return null;
  return preference === 'system' ? 'unspecified' : preference;
}

/**
 * Mounted once in the root layout: resolves the setting against the phone and provides the theme.
 * Named AppThemeProvider so it never collides with the navigation ThemeProvider (expo-router,
 * React Navigation), which the root layout nests inside it with the mapped colours.
 */
export function AppThemeProvider(props: AppThemeProviderProps): ReactNode {
  const { preference, onError } = props;
  const systemScheme = useColorScheme();
  const theme = selectTheme(props.themes ?? APP_THEMES, {
    scheme: resolveColorScheme(preference, systemScheme),
    mode: props.isColorBlind === true ? 'colorBlind' : 'standard',
  });
  const ground = theme.colors.background;

  // An allowed effect: it keeps native UI (alerts, pickers, the keyboard, the system bars on both
  // platforms) in the scheme the person chose in the app, not only the one the phone uses (never on
  // the web: appearanceSchemeFor).
  useEffect(() => {
    const scheme = appearanceSchemeFor(Platform.OS, preference);
    if (scheme !== null) Appearance.setColorScheme(scheme);
  }, [preference]);

  // An allowed effect: the root view behind every screen (seen behind an iOS sheet, during a
  // transition, behind Android's transparent system bars) takes the theme's ground instead of the
  // build-time colour. Cosmetic: if the call fails, the app config's backgroundColor stays and the
  // failure goes to onError (an effect event: a new onError never repaints).
  const reportPaintError = useEffectEvent((error: unknown) => {
    onError?.(error);
  });
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(ground).catch((error: unknown) => {
      reportPaintError(error);
    });
  }, [ground]);

  return <ThemeContext value={theme}>{props.children}</ThemeContext>;
}
