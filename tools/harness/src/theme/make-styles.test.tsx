// src/theme/make-styles.test.tsx
import { renderHook } from '@testing-library/react-native';

import { makeStyles } from './make-styles';
import { AppThemeProvider } from './theme-provider';

import type { ThemePreference } from './theme-types';
import type { ReactNode } from 'react';

describe('makeStyles', () => {
  it('builds the styles once per theme and keeps their identity across renders', async () => {
    const factory = jest.fn((theme: { readonly colors: { readonly surface: string } }) => ({
      card: { backgroundColor: theme.colors.surface },
    }));
    const useStyles = makeStyles(factory);
    let preference: ThemePreference = 'light';
    const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
      <AppThemeProvider preference={preference}>{children}</AppThemeProvider>
    );

    const { result, rerender } = await renderHook(() => useStyles(), { wrapper });
    const light = result.current;
    await rerender({});
    expect(result.current).toBe(light);

    preference = 'dark';
    await rerender({});
    expect(result.current).not.toBe(light);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
