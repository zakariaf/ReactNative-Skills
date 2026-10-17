// src/stores/settings-store.ts
import { create } from 'zustand';

import { DEFAULT_SETTINGS, settingsReducer } from './settings-reducer';

import type { SettingsState } from './settings-reducer';

type SettingsStore = SettingsState & { readonly toggleSound: () => void };

export const useSettingsStore = create<SettingsStore>()((set) => ({
  ...DEFAULT_SETTINGS,
  toggleSound: () => {
    set((state) => settingsReducer(state, { type: 'toggle-sound' }));
  },
}));
