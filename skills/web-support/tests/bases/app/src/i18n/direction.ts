// src/i18n/direction.ts
// Stand-in for rtl-and-direction's module: the only file that touches I18nManager.
import { reloadAppAsync } from 'expo';
import { I18nManager } from 'react-native';

import { err, ok } from '@/core/result';

import type { Direction } from './languages';
import type { Result } from '@/core/result';
import type { DirectionGuardFailure, DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';

export function readLayoutDirection(): Direction {
  return I18nManager.isRTL ? 'rtl' : 'ltr';
}

export function forceLayoutDirection(direction: Direction): void {
  const isRtl = direction === 'rtl';
  I18nManager.allowRTL(isRtl);
  I18nManager.forceRTL(isRtl);
}

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
