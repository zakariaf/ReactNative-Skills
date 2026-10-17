// src/services/haptics/fake-haptics.ts
import type { HapticCue, HapticsPort } from './haptics-port';

export type FakeHaptics = HapticsPort & { readonly played: HapticCue[] };

/** In-memory HapticsPort for tests: records every cue it is asked to play. */
export function createFakeHaptics(isSupported = true): FakeHaptics {
  const played: HapticCue[] = [];
  return { isSupported, played, play: (cue) => played.push(cue) };
}
