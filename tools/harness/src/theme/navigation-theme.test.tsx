// src/theme/navigation-theme.test.tsx
// no-providers: the providers under test are the wrapper: AppThemeProvider around the navigation
// theme, read back through expo-router's own useTheme.
import { renderHook } from '@testing-library/react-native';
import { DarkTheme, DefaultTheme, useTheme as useNavigationTheme } from 'expo-router';

import { NavigationThemeProvider, toNavigationTheme } from './navigation-theme';
import { PALETTE } from './palette';
import { APP_THEMES } from './theme-context';
import { AppThemeProvider } from './theme-provider';
import { selectTheme } from './theme-set';

import type { ThemePreference } from './theme-types';
import type { ReactNode } from 'react';

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(async () => {
    await Promise.resolve();
  }),
}));

function wrapperFor(preference: ThemePreference) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <AppThemeProvider preference={preference}>
        <NavigationThemeProvider>{children}</NavigationThemeProvider>
      </AppThemeProvider>
    );
  };
}

describe('toNavigationTheme', () => {
  it('maps every navigation colour from a semantic role', () => {
    const dark = toNavigationTheme(selectTheme(APP_THEMES, { scheme: 'dark', mode: 'standard' }));

    expect(dark).toStrictEqual({
      ...DarkTheme,
      colors: {
        primary: PALETTE.dark.primary,
        background: PALETTE.dark.background,
        card: PALETTE.dark.surface,
        text: PALETTE.dark.text,
        border: PALETTE.dark.separator,
        notification: PALETTE.dark.danger,
      },
    });
  });

  it('keeps the light base for the light theme', () => {
    const light = toNavigationTheme(selectTheme(APP_THEMES, { scheme: 'light', mode: 'standard' }));

    expect(light.dark).toBe(DefaultTheme.dark);
    expect(light.colors.card).toBe(PALETTE.light.surface);
  });
});

describe('NavigationThemeProvider', () => {
  it('gives the navigator the app theme the in-app setting chose', async () => {
    const { result } = await renderHook(() => useNavigationTheme(), {
      wrapper: wrapperFor('dark'),
    });

    expect(result.current.dark).toBe(true);
    expect(result.current.colors.background).toBe(PALETTE.dark.background);
    expect(result.current.colors.card).toBe(PALETTE.dark.surface);
  });
});
