// src/stores/settings/settings-store-context.test.tsx
// no-providers: this file tests SettingsStoreProvider itself, so it mounts the provider under test
// as the wrapper; the last case proves the hook's no-provider error.
import { act, renderHook } from '@testing-library/react-native';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';

import { selectThemePreference } from './settings-selectors';
import { createSettingsStore, useSettingsStore, useSettingsStoreApi } from './settings-store';
import { SettingsStoreProvider } from './settings-store-context';

import type { SettingsStore } from './settings-store';
import type { ReactNode } from 'react';

function freshStore(): SettingsStore {
  return createSettingsStore({
    storage: createFakeSettingsStorage(),
    errorLog: createFakeErrorLog(),
  });
}

function wrapperFor(store: SettingsStore) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <SettingsStoreProvider store={store}>{children}</SettingsStoreProvider>;
  };
}

describe('SettingsStoreProvider', () => {
  it('renders a subscriber again when its slice changes', async () => {
    const store = freshStore();
    const { result } = await renderHook(() => useSettingsStore(selectThemePreference), {
      wrapper: wrapperFor(store),
    });

    expect(result.current).toBe('system');
    await act(() => {
      store.getState().dispatch({ type: 'set-theme', theme: 'dark' });
    });
    expect(result.current).toBe('dark');
  });

  it('hands down the store itself for reads at call time', async () => {
    const store = freshStore();
    const { result } = await renderHook(() => useSettingsStoreApi(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current).toBe(store);
  });

  it('throws a named error without the provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(renderHook(() => useSettingsStore(selectThemePreference))).rejects.toThrow(
      'useSettingsStore() needs a <SettingsStoreProvider> above it',
    );
  });
});
