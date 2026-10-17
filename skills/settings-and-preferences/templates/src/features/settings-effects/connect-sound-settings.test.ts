// src/features/settings-effects/connect-sound-settings.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';
import { DEFAULT_SETTINGS } from '@/stores/settings/settings-schema';
import { createSettingsStore } from '@/stores/settings/settings-store';

import { connectSoundSettings, toSoundOutput } from './connect-sound-settings';

import type { SoundOutput } from './connect-sound-settings';

function setup() {
  const store = createSettingsStore({
    storage: createFakeSettingsStorage(),
    errorLog: createFakeErrorLog(),
  });
  const applied: SoundOutput[] = [];
  const disconnect = connectSoundSettings(store, (output) => {
    applied.push(output);
  });
  return { store, applied, disconnect };
}

describe('toSoundOutput', () => {
  it('turns the stored percent into the 0..1 an audio API takes', () => {
    expect(
      toSoundOutput({ ...DEFAULT_SETTINGS, soundEnabled: true, soundVolume: 35 }),
    ).toStrictEqual({ isOn: true, volume: 0.35 });
  });
});

describe('connectSoundSettings', () => {
  it('applies the saved settings at once, before any change', () => {
    expect(setup().applied).toStrictEqual([{ isOn: false, volume: 0.8 }]);
  });

  it('applies every sound change, and nothing for other settings', () => {
    const { store, applied } = setup();

    store.getState().dispatch({ type: 'set-theme', theme: 'dark' });
    store.getState().dispatch({ type: 'set-sound', isOn: true, volume: 40 });

    expect(applied).toStrictEqual([
      { isOn: false, volume: 0.8 },
      { isOn: true, volume: 0.4 },
    ]);
  });

  it('stops applying after the unsubscribe it returns', () => {
    const { store, applied, disconnect } = setup();

    disconnect();
    store.getState().dispatch({ type: 'set-sound', isOn: true, volume: 40 });

    expect(applied).toHaveLength(1);
  });
});
