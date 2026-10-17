// src/services/haptics/expo-haptics-haptics-adapter.ts (example: a shape to imitate, never copied)
// The one licensed way to ignore a failure: a cosmetic, best-effort effect, inside its adapter, with
// a `best-effort:` comment that says why. check-error-spine accepts the marker only in a
// *-adapter.ts file. A missed tap costs nothing; a swallowed save costs the user's data.
import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics';

import type { HapticsPort } from './haptics-port';

export function createExpoHapticsAdapter(): HapticsPort {
  return {
    tap: () => {
      // impactAsync rejects with UnavailabilityError where the native module is missing (a build made
      // before expo-haptics was added) and, on Android, when the React context is gone during a
      // reload (read from expo-haptics 57.0.3 source). Web implements it with navigator.vibrate.
      // best-effort: haptics are decoration; a missed tap costs the user nothing.
      impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
    },
  };
}
