// src/stores/settings/settings-store.ts
// The one owner of the settings: hydrated synchronously from storage before the first paint, then
// every change is reduced, persisted, and only then published, so no screen ever shows a value that
// is not saved. Created once at startup (open-device-settings.ts on a device, with a fake storage in
// tests); never a module-level store. Components read it through useSettingsStore(selector), under
// the SettingsStoreProvider the root layout mounts (settings-store-context.tsx).
import { createContext, use } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { decodeSettings, encodeSettings } from './settings-codec';
import { settingsReducer } from './settings-reducer';

import type { SettingsAction } from './settings-reducer';
import type { Settings } from './settings-schema';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type {
  SettingsStoragePort,
  SettingsWriteFailure,
} from '@/services/settings-storage/settings-storage-port';
import type { StoreApi } from 'zustand/vanilla';

export type SettingsStoreState = {
  readonly settings: Settings;
  /** false when the saved settings could not be read: this session keeps changes in memory only. */
  readonly isPersistent: boolean;
  /** Set when the last change could not be saved (the screen says so); null after a saved change. */
  readonly lastWriteFailure: SettingsWriteFailure | null;
  readonly dispatch: (action: SettingsAction) => void;
};

export type SettingsStore = StoreApi<SettingsStoreState>;

export type SettingsStoreDeps = {
  readonly storage: SettingsStoragePort;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

type Hydrated = Pick<SettingsStoreState, 'settings' | 'isPersistent'>;

/**
 * Reads once. Unreadable storage runs the session on the defaults without ever writing, so the saved
 * settings survive for the next launch; repaired fields are recorded (the adapter recorded a read failure).
 */
function hydrate({ storage, errorLog }: SettingsStoreDeps): Hydrated {
  const read = storage.read();
  if (!read.ok) return { settings: decodeSettings(null).settings, isPersistent: false };
  const decoded = decodeSettings(read.value);
  if (decoded.repairedKeys.length > 0) {
    const fields = decoded.repairedKeys.join(', ');
    errorLog.record('storage', new Error(`saved settings fell back to defaults: ${fields}`));
  }
  return { settings: decoded.settings, isPersistent: true };
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const { settings, isPersistent } = hydrate(deps);
  return createStore<SettingsStoreState>()((set, get) => ({
    settings,
    isPersistent,
    lastWriteFailure: null,
    dispatch: (action) => {
      const current = get().settings;
      const next = settingsReducer(current, action);
      if (next === current) return;
      if (isPersistent) {
        const written = deps.storage.write(encodeSettings(next));
        if (!written.ok) {
          set({ lastWriteFailure: written.error });
          return;
        }
      }
      set({ settings: next, lastWriteFailure: null });
    },
  }));
}

/** Filled by SettingsStoreProvider (settings-store-context.tsx); null outside it. */
export const SettingsStoreContext = createContext<SettingsStore | null>(null);

/** The store itself, for code that reads at call time (getState) or subscribes outside render. */
export function useSettingsStoreApi(): SettingsStore {
  const store = use(SettingsStoreContext);
  if (store === null) {
    throw new Error('useSettingsStore() needs a <SettingsStoreProvider> above it');
  }
  return store;
}

/** Primitives: useSettingsStore(selectThemePreference); a built object or array: useShallow. */
export function useSettingsStore<TSlice>(selector: (state: SettingsStoreState) => TSlice): TSlice {
  return useStore(useSettingsStoreApi(), selector);
}
