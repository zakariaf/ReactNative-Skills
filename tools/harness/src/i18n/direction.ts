// src/i18n/direction.ts
// The only module that touches I18nManager (the lint config exempts this file alone). React Native
// reads the layout direction once per JS run, so changing it takes allowRTL + forceRTL and a reload
// of the bundle. Layout decisions read it through readLayoutDirection() or useDirection().
import { reloadAppAsync } from 'expo';
import { I18nManager } from 'react-native';

import { err, ok } from '@/core/result';

import type { Direction } from './languages';
import type { Result } from '@/core/result';
import type {
  DirectionGuardFailure,
  DirectionGuardPort,
} from '@/services/direction-guard/direction-guard-port';

/** The layout direction of this JS run: what rows, start/end keys and the navigator follow. */
export function readLayoutDirection(): Direction {
  return I18nManager.isRTL ? 'rtl' : 'ltr';
}

/**
 * Both calls, always: forceRTL(true) alone leaves allowRTL off where an earlier build turned it off,
 * and allowRTL(false) is what keeps a left-to-right language left to right on a right-to-left phone.
 */
export function forceLayoutDirection(direction: Direction): void {
  const isRtl = direction === 'rtl';
  I18nManager.allowRTL(isRtl);
  I18nManager.forceRTL(isRtl);
}

/**
 * Records the pending direction first (so a flip that does not take becomes a give-up, never a
 * restart loop), forces it, and reloads the bundle. Call it only from a mounted component (an effect
 * or a press handler) after the language choice is saved: a reload while the bundle is still being
 * evaluated crashed a Release build. Without the record it does not reload at all. `beforeReload`
 * runs after the flip and right before the reload: the caller that has the services closes native
 * work there (an app with audio passes `() => services.audio.dispose()`). The reload follows the flip
 * even when the hook rejects (the native flags are already set; a run that kept going would show the
 * old layout with the new flags pending), and the hook's rejection then reaches the caller.
 */
export async function restartForDirection(
  direction: Direction,
  guard: DirectionGuardPort,
  beforeReload: () => Promise<void> = () => Promise.resolve(),
): Promise<Result<void, DirectionGuardFailure>> {
  const recorded = guard.writePending(direction);
  if (!recorded.ok) return err(recorded.error);
  forceLayoutDirection(direction);
  try {
    await beforeReload();
  } finally {
    await reloadAppAsync(`layout direction -> ${direction}`);
  }
  return ok(undefined);
}
