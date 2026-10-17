// src/features/settings-effects/haptics-gate.ts
// The effect of the Haptics switch: the haptics adapter asks this gate at every pulse, so turning
// haptics off stops the very next pulse, with no subscription to forget and no restart. The gate
// exists before the settings store does: the composition root creates the haptics adapter first
// (the store needs the data layer's error log), so the root layout creates the gate, hands
// `isEnabled` to createDeviceServices, and connects the store once it is open. Until then no pulse
// plays. audio-and-haptics-feedback owns the haptics port and its adapter.
import { selectIsHapticsOn } from '@/stores/settings/settings-selectors';

import type { SettingsStore } from '@/stores/settings/settings-store';

export type HapticsGate = {
  /** The adapter's isEnabled: reads the setting at call time; false until a store is connected. */
  readonly isEnabled: () => boolean;
  /** Called once, right after the settings store is opened in the first-render initializer. */
  readonly connect: (store: Pick<SettingsStore, 'getState'>) => void;
};

export function createHapticsGate(): HapticsGate {
  let connected: Pick<SettingsStore, 'getState'> | null = null;
  return {
    isEnabled: () => connected !== null && selectIsHapticsOn(connected.getState()),
    connect: (store) => {
      connected = store;
    },
  };
}
