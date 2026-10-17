// src/features/crash-recovery/crash-fallback.test.tsx
// no-providers: proves the no-provider default. Under the root layout's boundary the fallback renders
// outside every provider, and an error there is a fatal crash nothing records, so this test is the
// proof that it reads no provider context and that its copy and background resolve without one.
// allow-style-assertion: the background is this fallback's contract. Outside ThemeProvider AppText
// draws with the default theme's text colour, so the screen must paint that theme's background. The
// writing direction is the other contract: outside I18nProvider only the fallback's own
// TextLocaleProvider gives AppText the shown language's direction.
import { render, renderHook, screen, userEvent } from '@testing-library/react-native';

import en from '@/i18n/catalogs/en.json';
import { directionOf, LANGUAGES } from '@/i18n/languages';
import { recordShownLanguage } from '@/i18n/translate-now';
import { useTheme } from '@/theme/use-theme';

import { CrashFallback } from './crash-fallback';

describe('CrashFallback', () => {
  beforeEach(() => {
    // No earlier provider's language: the copy follows jest-expo's device locale (English).
    recordShownLanguage(null);
  });

  it('shows the source-language copy and the default theme background without any provider', async () => {
    const { result } = await renderHook(() => useTheme());
    await render(<CrashFallback onRestart={jest.fn()} />);

    expect(screen.getByText(en['crash.title'])).toBeOnTheScreen();
    expect(screen.getByText(en['crash.body'])).toBeOnTheScreen();
    expect(screen.getByTestId('crash.screen')).toHaveStyle({
      backgroundColor: result.current.colors.background,
    });
  });

  it.each(LANGUAGES)('lays out its %s copy in the direction of that language', async (language) => {
    recordShownLanguage({ language, digits: 'automatic' });
    await render(<CrashFallback onRestart={jest.fn()} />);

    expect(screen.getByTestId('crash.title')).toHaveStyle({
      writingDirection: directionOf(language),
    });
  });

  it('leaves only through its one button', async () => {
    const user = userEvent.setup();
    const onRestart = jest.fn();
    await render(<CrashFallback onRestart={onRestart} />);

    expect(onRestart).not.toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: en['crash.restart'] }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
