// src/stores/settings/settings-selectors.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';

import { DEFAULT_SETTINGS } from './settings-schema';
import {
  selectDigits,
  selectDispatch,
  selectIsHapticsOn,
  selectIsSoundOn,
  selectLanguage,
  selectLastWriteFailure,
  selectReduceMotionPreference,
  selectSettings,
  selectSoundVolume,
  selectThemePreference,
} from './settings-selectors';
import { createSettingsStore } from './settings-store';

function freshStore() {
  return createSettingsStore({
    storage: createFakeSettingsStorage(),
    errorLog: createFakeErrorLog(),
  });
}

describe('settings selectors', () => {
  it('reads the first-launch values', () => {
    const state = freshStore().getState();

    expect([
      selectLanguage(state),
      selectDigits(state),
      selectThemePreference(state),
      selectReduceMotionPreference(state),
      selectIsHapticsOn(state),
      selectIsSoundOn(state),
      selectSoundVolume(state),
      selectLastWriteFailure(state),
    ]).toStrictEqual([null, 'automatic', 'system', 'system', true, false, 80, null]);
  });

  it('returns references already in the state, so a re-render sees the same object', () => {
    const state = freshStore().getState();

    expect(selectSettings(state)).toBe(selectSettings(state));
    expect(selectSettings(state)).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('follows a dispatched change', () => {
    const store = freshStore();

    selectDispatch(store.getState())({ type: 'set-sound', isOn: true, volume: 20 });

    expect(selectIsSoundOn(store.getState())).toBe(true);
    expect(selectSoundVolume(store.getState())).toBe(20);
  });
});
