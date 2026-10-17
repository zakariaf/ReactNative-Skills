// src/features/settings-effects/haptics-gate.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';
import { encodeSettings } from '@/stores/settings/settings-codec';
import { DEFAULT_SETTINGS } from '@/stores/settings/settings-schema';
import { createSettingsStore } from '@/stores/settings/settings-store';

import { createHapticsGate } from './haptics-gate';

function openStore(isHapticsOn = true) {
  return createSettingsStore({
    storage: createFakeSettingsStorage({
      text: encodeSettings({ ...DEFAULT_SETTINGS, hapticsEnabled: isHapticsOn }),
    }),
    errorLog: createFakeErrorLog(),
  });
}

describe('createHapticsGate', () => {
  it('plays no pulse before the settings store is connected', () => {
    expect(createHapticsGate().isEnabled()).toBe(false);
  });

  it('follows the saved setting from the moment the store is connected', () => {
    const gate = createHapticsGate();

    gate.connect(openStore(false));

    expect(gate.isEnabled()).toBe(false);
  });

  it('answers from the store at call time, so the next pulse follows the switch', () => {
    const store = openStore();
    const gate = createHapticsGate();
    gate.connect(store);

    expect(gate.isEnabled()).toBe(true);
    store.getState().dispatch({ type: 'set-haptics', isOn: false });
    expect(gate.isEnabled()).toBe(false);
  });
});
