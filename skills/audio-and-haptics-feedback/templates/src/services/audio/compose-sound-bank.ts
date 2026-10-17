// src/services/audio/compose-sound-bank.ts
import { UI_SOUNDS } from './synth/ui-sounds';

import type { SoundBank, SoundSpec } from './audio-port';

/** The app-wide UI sounds as a bank: category 'ui', so they follow the sound effects setting. */
export const UI_SOUND_BANK: SoundBank = Object.fromEntries(
  Object.entries(UI_SOUNDS).map(([id, recipe]): [string, SoundSpec] => [
    id,
    { category: 'ui', recipe },
  ]),
);

/**
 * The one bank the root layout passes to AudioPort.load: the UI sounds plus every feature's (or
 * game's) bank. An id in the reserved `ui.` namespace, or an id two banks share, would silently
 * replace another sound, so it throws instead.
 */
export function composeSoundBank(...banks: readonly SoundBank[]): SoundBank {
  const seen = new Set(Object.keys(UI_SOUND_BANK));
  const clashes: string[] = [];
  for (const id of banks.flatMap((bank) => Object.keys(bank))) {
    if (id.startsWith('ui.') || seen.has(id)) clashes.push(id);
    seen.add(id);
  }
  if (clashes.length > 0) {
    throw new Error(
      `Sound ids clash with the ui. namespace or another bank: ${clashes.join(', ')}`,
    );
  }
  return banks.reduce<SoundBank>((all, bank) => ({ ...all, ...bank }), UI_SOUND_BANK);
}

/** True when the app has a music track: without one, every music control is hidden. */
export function hasMusic(bank: SoundBank): boolean {
  return Object.values(bank).some((spec) => spec.category === 'music');
}
