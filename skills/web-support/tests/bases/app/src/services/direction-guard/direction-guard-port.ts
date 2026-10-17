// src/services/direction-guard/direction-guard-port.ts
import type { Result } from '@/core/result';

export type DirectionGuardFailure = { readonly kind: 'direction-guard-not-saved' };
export type PendingRestart = 'ltr' | 'rtl' | null | 'unreadable';
export type DirectionGuardPort = {
  readonly readPending: () => PendingRestart;
  readonly writePending: (direction: 'ltr' | 'rtl' | null) => Result<void, DirectionGuardFailure>;
};
