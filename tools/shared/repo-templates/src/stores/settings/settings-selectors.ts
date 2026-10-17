// src/stores/settings/settings-selectors.ts
// Each selector returns a primitive or a reference already in the state; a selector that builds a
// new object goes through useShallow at the call site. `…Preference` names keep the raw choice
// ('system' included) apart from the resolved value the providers compute.
import type { SettingsStoreState } from './settings-store';

type Settings = SettingsStoreState['settings'];

export const selectSettings = (state: SettingsStoreState): Settings => state.settings;
export const selectLanguage = (state: SettingsStoreState): Settings['language'] =>
  state.settings.language;
export const selectDigits = (state: SettingsStoreState): Settings['digits'] =>
  state.settings.digits;
export const selectThemePreference = (state: SettingsStoreState): Settings['theme'] =>
  state.settings.theme;
export const selectReduceMotionPreference = (state: SettingsStoreState): Settings['reduceMotion'] =>
  state.settings.reduceMotion;
export const selectIsHapticsOn = (state: SettingsStoreState): boolean =>
  state.settings.hapticsEnabled;
export const selectIsSoundOn = (state: SettingsStoreState): boolean => state.settings.soundEnabled;
export const selectSoundVolume = (state: SettingsStoreState): number => state.settings.soundVolume;
export const selectLastWriteFailure = (
  state: SettingsStoreState,
): SettingsStoreState['lastWriteFailure'] => state.lastWriteFailure;
export const selectDispatch = (state: SettingsStoreState): SettingsStoreState['dispatch'] =>
  state.dispatch;
