// src/theme/theme-set.test.ts
import { PALETTE } from './palette';
import { createThemeSet, resolveColorScheme, selectTheme } from './theme-set';

describe('theme set', () => {
  it('builds each theme once, so a theme keeps its identity', () => {
    const themes = createThemeSet(PALETTE);
    const dark = selectTheme(themes, { scheme: 'dark', mode: 'standard' });

    expect(selectTheme(themes, { scheme: 'dark', mode: 'standard' })).toBe(dark);
    expect(dark.colors).toBe(PALETTE.dark);
  });

  it('falls back to the standard theme when the palette has no colour-blind variant', () => {
    const themes = createThemeSet(PALETTE);

    expect(selectTheme(themes, { scheme: 'light', mode: 'colorBlind' }).mode).toBe('standard');
  });

  it('uses the colour-blind variant when the palette ships one', () => {
    const themes = createThemeSet({
      ...PALETTE,
      colorBlind: { light: PALETTE.light, dark: PALETTE.dark },
    });

    expect(selectTheme(themes, { scheme: 'light', mode: 'colorBlind' }).key).toBe(
      'colorBlind.light',
    );
  });

  it.each([
    { preference: 'system', system: 'dark', expected: 'dark' },
    { preference: 'system', system: 'unspecified', expected: 'light' },
    { preference: 'system', system: null, expected: 'light' },
    { preference: 'light', system: 'dark', expected: 'light' },
    { preference: 'dark', system: 'light', expected: 'dark' },
  ] as const)(
    'resolves $preference on a $system phone to $expected',
    ({ preference, system, expected }) => {
      expect(resolveColorScheme(preference, system)).toBe(expected);
    },
  );
});
