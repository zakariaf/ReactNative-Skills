// src/features/settings/use-settings-model.test.tsx
// The model reads the settings store and useT(). test/test-app.tsx (the
// canonical provider tree) has none of them yet, so this test puts the real ones inside the
// providers createProvidersWrapper builds: the store over a fake storage, the app's I18nProvider
// (en, a throwing onError) and MotionConfig fed from the store. The toggle feedback is a recording
// onToggled in the input.
import { act, renderHook } from '@testing-library/react-native';

import { err, ok } from '@/core/result';
import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';
import { selectReduceMotionPreference } from '@/stores/settings/settings-selectors';
import { createSettingsStore, useSettingsStore } from '@/stores/settings/settings-store';
import { SettingsStoreProvider } from '@/stores/settings/settings-store-context';
import { MotionConfig } from '@/ui/a11y/motion-config';
import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { createProvidersWrapper } from '@test/render-with-providers';

import { useSettingsModel } from './use-settings-model';

import type { SettingsModelInput } from './use-settings-model';
import type { Language } from '@/i18n/languages';
import type { FakeSettingsStorageOptions } from '@/services/settings-storage/fake-settings-storage';
import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

function StoreMotion({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <MotionConfig preference={useSettingsStore(selectReduceMotionPreference)}>
      {children}
    </MotionConfig>
  );
}

type ModelOptions = {
  readonly storage?: FakeSettingsStorageOptions;
  readonly canVibrate?: boolean;
  readonly isResetFailing?: boolean;
};

async function renderModel(options: ModelOptions = {}) {
  const { storage = {}, canVibrate = true, isResetFailing = false } = options;
  const store = createSettingsStore({
    storage: createFakeSettingsStorage(storage),
    errorLog: createFakeErrorLog(),
  });
  const feedback = jest.fn();
  const restarts: Language[] = [];
  const refetchServerState = jest.fn();
  const { wrapper: Providers } = createProvidersWrapper();
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <Providers>
        <SettingsStoreProvider store={store}>
          <I18nProvider language="en" digits="automatic" onError={failOnError}>
            <StoreMotion>{children}</StoreMotion>
          </I18nProvider>
        </SettingsStoreProvider>
      </Providers>
    );
  }
  const input: SettingsModelInput = {
    context: { isSignedIn: false, canVibrate, isPremium: false, hasPrivacyChoices: false },
    deviceLocales: [{ languageTag: 'en-US', languageCode: 'en', languageScriptCode: null }],
    layoutDirection: 'ltr',
    onRestartNeeded: (language) => {
      restarts.push(language);
    },
    dataResets: {
      deleteAllData: () => (isResetFailing ? err({ kind: 'data-not-deleted' }) : ok(undefined)),
      refetchServerState,
    },
    onToggled: feedback,
  };
  const { result } = await renderHook(() => useSettingsModel(input), { wrapper: Wrapper });
  return { result, store, feedback, restarts, refetchServerState };
}

describe('useSettingsModel', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
  });

  it('labels the visible groups and rows, and leaves out what does not apply', async () => {
    const { result } = await renderModel({ canVibrate: false });
    const sound = result.current.groups.find((group) => group.id === 'sound');

    expect(sound?.title).toBe('Sound and haptics');
    expect(sound?.rows.map((row) => row.label)).toStrictEqual(['Sound effects', 'Volume']);
    expect(sound?.rows.map((row) => row.testID)).toStrictEqual([
      'settings.sound-switch',
      'settings.sound-volume-slider',
    ]);
  });

  it('shows "System" with the language the phone resolves to, then the chosen name', async () => {
    const { result } = await renderModel();

    expect(result.current.languageValue).toBe('System (⁨English⁩)');
    await act(() => {
      result.current.actions.onSelectLanguage('ar');
    });
    expect(result.current.languageValue).toBe('العربية');
  });

  it('asks for a restart only when the new language reads the other way', async () => {
    const { result, restarts } = await renderModel();

    await act(() => {
      result.current.actions.onSelectLanguage(null);
    });
    await act(() => {
      result.current.actions.onSelectLanguage('ar');
    });

    expect(restarts).toStrictEqual(['ar']);
  });

  it('opens no restart dialog when the language could not be saved', async () => {
    const { result, restarts } = await renderModel({ storage: { isWriteFailing: true } });

    await act(() => {
      result.current.actions.onSelectLanguage('ar');
    });

    expect(restarts).toStrictEqual([]);
    expect(result.current.settings.language).toBeNull();
    expect(result.current.saveFailedText).toBe('That change could not be saved. Try again.');
  });

  it('saves a switch, then plays the toggle feedback once', async () => {
    const { result, store, feedback } = await renderModel();

    await act(() => {
      result.current.actions.onToggleSound();
    });

    expect(store.getState().settings.soundEnabled).toBe(true);
    expect(feedback).toHaveBeenCalledTimes(1);
  });

  it("shows the phone's reduce motion while the setting says System, and writes the opposite", async () => {
    systemA11yStore.setState({ isReduceMotionOn: true });
    const { result, store } = await renderModel();

    expect(result.current.isReduceMotionOn).toBe(true);
    await act(() => {
      result.current.actions.onToggleReduceMotion();
    });
    expect(store.getState().settings.reduceMotion).toBe('off');
    expect(result.current.isReduceMotionOn).toBe(false);
  });

  it('speaks the volume as a sentence with a percent', async () => {
    const { result } = await renderModel();

    expect(result.current.volumeText).toBe('Volume at 80%');
  });

  it('says so when a change could not be saved, and keeps the old value', async () => {
    const { result } = await renderModel({ storage: { isWriteFailing: true } });

    await act(() => {
      result.current.actions.onToggleHaptics();
    });

    expect(result.current.settings.hapticsEnabled).toBe(true);
    expect(result.current.saveFailedText).toBe('That change could not be saved. Try again.');
  });

  it('deletes the data without touching a setting, then refetches server state', async () => {
    const { result, store, refetchServerState } = await renderModel();
    const before = store.getState().settings;

    await act(() => {
      result.current.actions.onConfirmDeleteAllData();
    });

    expect(store.getState().settings).toBe(before);
    expect(refetchServerState).toHaveBeenCalledTimes(1);
    expect(result.current.deleteFailedText).toBeNull();
  });

  it('says so when the data could not be deleted', async () => {
    const { result } = await renderModel({ isResetFailing: true });

    await act(() => {
      result.current.actions.onConfirmDeleteAllData();
    });

    expect(result.current.deleteFailedText).toBe('Your data could not be deleted. Try again.');
  });
});
