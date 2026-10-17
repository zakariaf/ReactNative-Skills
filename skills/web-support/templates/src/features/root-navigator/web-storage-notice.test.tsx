// src/features/root-navigator/web-storage-notice.test.tsx
// no-providers: proves the no-provider default. WebStorageGate is the root layout's outermost element,
// so the notice renders outside every provider; this test is the proof that its copy, text direction
// and background resolve without one. The catalog keys are the crash fallback's: the notice's own
// keys belong to the app's catalogs, and any two keys prove the wiring.
// allow-style-assertion: outside ThemeProvider AppText draws with the default theme's text colour, so
// the notice must paint that theme's background, and only its own TextLocaleProvider gives AppText the
// shown language's direction.
import { render, renderHook, screen } from '@testing-library/react-native';

import en from '@/i18n/catalogs/en.json';
import { directionOf, LANGUAGES } from '@/i18n/languages';
import { recordShownLanguage } from '@/i18n/translate-now';
import { useTheme } from '@/theme/use-theme';

import { WebStorageNotice } from './web-storage-notice';

describe('WebStorageNotice', () => {
  beforeEach(() => {
    // No earlier provider's language: the copy follows jest-expo's device locale (English).
    recordShownLanguage(null);
  });

  it('shows its copy and the default theme background without any provider', async () => {
    const { result } = await renderHook(() => useTheme());
    const onMessageError = jest.fn();

    await render(
      <WebStorageNotice
        reason="in-use-elsewhere"
        titleKey="crash.title"
        bodyKey="crash.body"
        onMessageError={onMessageError}
      />,
    );

    expect(screen.getByText(en['crash.title'])).toBeOnTheScreen();
    expect(screen.getByText(en['crash.body'])).toBeOnTheScreen();
    expect(screen.getByTestId('web-storage.other-tab')).toHaveStyle({
      backgroundColor: result.current.colors.background,
    });
    expect(onMessageError).not.toHaveBeenCalled();
  });

  it('gives each reason its own testID', async () => {
    await render(
      <WebStorageNotice
        reason="unsupported"
        titleKey="crash.title"
        bodyKey="crash.body"
        onMessageError={jest.fn()}
      />,
    );

    expect(screen.getByTestId('web-storage.unsupported')).toBeOnTheScreen();
    expect(screen.queryByTestId('web-storage.other-tab')).not.toBeOnTheScreen();
  });

  it.each(LANGUAGES)('lays out its %s copy in the direction of that language', async (language) => {
    recordShownLanguage({ language, digits: 'automatic' });

    await render(
      <WebStorageNotice
        reason="in-use-elsewhere"
        titleKey="crash.title"
        bodyKey="crash.body"
        onMessageError={jest.fn()}
      />,
    );

    expect(screen.getByTestId('web-storage.title')).toHaveStyle({
      writingDirection: directionOf(language),
    });
  });
});
