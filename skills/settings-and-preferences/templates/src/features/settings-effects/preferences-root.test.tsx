// src/features/settings-effects/preferences-root.test.tsx
// no-providers: PreferencesRoot is the provider tree under test (i18n, theme, motion and text
// locale); the test mounts only the settings store it reads above it.
import { act, renderHook } from '@testing-library/react-native';

import { useLanguage } from '@/i18n/language-context';
import { useT } from '@/i18n/t-context';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';
import { createSettingsStore } from '@/stores/settings/settings-store';
import { SettingsStoreProvider } from '@/stores/settings/settings-store-context';
import { useTextLocale } from '@/theme/use-text-locale';
import { useTheme } from '@/theme/use-theme';
import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { PreferencesRoot } from './preferences-root';

import type { SettingsAction } from '@/stores/settings/settings-reducer';
import type { SettingsStore } from '@/stores/settings/settings-store';
import type { ReactNode } from 'react';

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(async () => {
    await Promise.resolve();
  }),
}));

const ENGLISH_PHONE = [{ languageTag: 'en-US', languageCode: 'en', languageScriptCode: null }];

function failOnError(error: unknown): never {
  throw error instanceof Error ? error : new Error(String(error));
}

function useApplied() {
  const t = useT();
  return {
    language: useLanguage(),
    direction: useTextLocale().direction,
    scheme: useTheme().scheme,
    isReducedMotion: useReduceMotion(),
    volumeText: t('settings.sound-volume.value', { volumeRate: 0.8 }),
  };
}

async function renderApplied() {
  const store: SettingsStore = createSettingsStore({
    storage: createFakeSettingsStorage(),
    errorLog: createFakeErrorLog(),
  });
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <SettingsStoreProvider store={store}>
        <PreferencesRoot deviceLocales={ENGLISH_PHONE} onError={failOnError}>
          {children}
        </PreferencesRoot>
      </SettingsStoreProvider>
    );
  }
  const view = await renderHook(useApplied, { wrapper: Wrapper });
  const dispatch = async (action: SettingsAction): Promise<void> => {
    await act(() => {
      store.getState().dispatch(action);
    });
  };
  return { result: view.result, dispatch };
}

describe('PreferencesRoot', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
  });

  it('follows the phone until the person chooses', async () => {
    const { result } = await renderApplied();

    expect(result.current).toMatchObject({
      language: 'en',
      direction: 'ltr',
      scheme: 'light',
      isReducedMotion: false,
    });
  });

  it('switches the language and its direction at once', async () => {
    const { result, dispatch } = await renderApplied();

    await dispatch({ type: 'set-language', language: 'ar' });

    expect(result.current).toMatchObject({ language: 'ar', direction: 'rtl' });
  });

  it('applies the digits setting to every formatted number', async () => {
    const { result, dispatch } = await renderApplied();

    await dispatch({ type: 'set-language', language: 'ar' });
    expect(result.current.volumeText).toMatch(/٨٠/);
    await dispatch({ type: 'set-digits', digits: 'latin' });
    expect(result.current.volumeText).toMatch(/80/);
  });

  it('applies the theme and reduce motion choices to the whole tree', async () => {
    const { result, dispatch } = await renderApplied();

    await dispatch({ type: 'set-theme', theme: 'dark' });
    await dispatch({ type: 'set-reduce-motion', reduceMotion: 'on' });

    expect(result.current).toMatchObject({ scheme: 'dark', isReducedMotion: true });
  });
});
