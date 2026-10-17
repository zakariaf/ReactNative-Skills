// src/ui/a11y/system-a11y-store.ts
// The one mirror of the phone's accessibility switches: a module-level store that is never persisted
// (contracts/stores.json lists it under osMirrorStores). Fed by a platform listener elsewhere.
import { createStore } from 'zustand/vanilla';

export type SystemA11yState = {
  readonly isReduceMotionOn: boolean;
  readonly isScreenReaderOn: boolean;
};

export const systemA11yStore = createStore<SystemA11yState>()(() => ({
  isReduceMotionOn: false,
  isScreenReaderOn: false,
}));

export function setReduceMotion(isOn: boolean): void {
  systemA11yStore.setState({ isReduceMotionOn: isOn });
}
