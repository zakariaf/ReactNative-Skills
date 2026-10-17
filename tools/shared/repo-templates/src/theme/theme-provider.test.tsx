// src/theme/theme-provider.test.tsx
// no-providers: the provider under test is the wrapper; the last case proves the theme context's
// default, which is what a component test without a wrapper renders on.
import { renderHook, waitFor } from '@testing-library/react-native';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { Appearance } from 'react-native';

import { PALETTE } from './palette';
import { AppThemeProvider, appearanceSchemeFor } from './theme-provider';
import { createThemeSet } from './theme-set';
import { useTheme } from './use-theme';

import type { AppThemeProviderProps } from './theme-provider';
import type { ReactNode } from 'react';

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(async () => {
    await Promise.resolve();
  }),
}));

function wrapperFor(props: Omit<AppThemeProviderProps, 'children'>) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <AppThemeProvider {...props}>{children}</AppThemeProvider>;
  };
}

describe('AppThemeProvider', () => {
  it('provides the dark theme when the setting says dark', async () => {
    const { result } = await renderHook(() => useTheme(), {
      wrapper: wrapperFor({ preference: 'dark' }),
    });

    expect(result.current.scheme).toBe('dark');
    expect(result.current.colors).toBe(PALETTE.dark);
  });

  it('mirrors the choice into Appearance so native UI follows the app, not only the phone', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');

    await renderHook(() => useTheme(), { wrapper: wrapperFor({ preference: 'light' }) });
    await renderHook(() => useTheme(), { wrapper: wrapperFor({ preference: 'system' }) });

    expect(setColorScheme).toHaveBeenCalledWith('light');
    expect(setColorScheme).toHaveBeenCalledWith('unspecified');
  });

  it('leaves Appearance alone on the web, where react-native-web has no setColorScheme', () => {
    expect(appearanceSchemeFor('web', 'dark')).toBeNull();
    expect(appearanceSchemeFor('android', 'dark')).toBe('dark');
    expect(appearanceSchemeFor('ios', 'system')).toBe('unspecified');
  });

  it('paints the root view behind every screen with the theme ground', async () => {
    await renderHook(() => useTheme(), { wrapper: wrapperFor({ preference: 'dark' }) });

    expect(setBackgroundColorAsync).toHaveBeenLastCalledWith(PALETTE.dark.background);
  });

  it('hands a failed root-view paint to onError and keeps the theme', async () => {
    const failure = new Error('no root view');
    jest.mocked(setBackgroundColorAsync).mockRejectedValueOnce(failure);
    const onError = jest.fn();

    const { result } = await renderHook(() => useTheme(), {
      wrapper: wrapperFor({ preference: 'dark', onError }),
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure);
    });
    expect(result.current.scheme).toBe('dark');
  });

  it('switches to the colour-blind variant only when the palette ships one', async () => {
    const themes = createThemeSet({
      ...PALETTE,
      colorBlind: { light: PALETTE.light, dark: PALETTE.dark },
    });
    const { result } = await renderHook(() => useTheme(), {
      wrapper: wrapperFor({ preference: 'light', isColorBlind: true, themes }),
    });
    const { result: withoutVariant } = await renderHook(() => useTheme(), {
      wrapper: wrapperFor({ preference: 'light', isColorBlind: true }),
    });

    expect(result.current.key).toBe('colorBlind.light');
    expect(withoutVariant.current.key).toBe('standard.light');
  });

  it('renders the light theme without a provider (component tests need no wrapper)', async () => {
    const { result } = await renderHook(() => useTheme());

    expect(result.current.key).toBe('standard.light');
  });
});
