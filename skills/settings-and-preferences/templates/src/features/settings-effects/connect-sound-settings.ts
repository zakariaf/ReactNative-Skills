// src/features/settings-effects/connect-sound-settings.ts
// The effect of the Sound effects switch and its volume slider: a store subscription the root
// layout starts once, at startup, with the audio side's setter; it returns the unsubscribe. A
// subscription and not a React effect, so it works with no screen mounted and never renders.
import type { Settings } from '@/stores/settings/settings-schema';
import type { SettingsStore } from '@/stores/settings/settings-store';

/** What the audio side receives: on or off, and a volume in 0..1 (the store keeps integer percent). */
export type SoundOutput = { readonly isOn: boolean; readonly volume: number };

/** The one place the stored percent becomes the 0..1 an audio API takes. */
export function toSoundOutput(settings: Settings): SoundOutput {
  return { isOn: settings.soundEnabled, volume: settings.soundVolume / 100 };
}

function isSoundChange(next: Settings, previous: Settings): boolean {
  return next.soundEnabled !== previous.soundEnabled || next.soundVolume !== previous.soundVolume;
}

/** Applies the saved sound settings now, then after every change to them. */
export function connectSoundSettings(
  store: Pick<SettingsStore, 'getState' | 'subscribe'>,
  applySound: (output: SoundOutput) => void,
): () => void {
  applySound(toSoundOutput(store.getState().settings));
  return store.subscribe((state, previous) => {
    if (isSoundChange(state.settings, previous.settings)) applySound(toSoundOutput(state.settings));
  });
}
