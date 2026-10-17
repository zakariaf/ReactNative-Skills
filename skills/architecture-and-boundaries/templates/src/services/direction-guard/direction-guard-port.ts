// src/services/direction-guard/direction-guard-port.ts
// Remembers, across exactly one JS reload, which layout direction the app reloaded to reach, so a
// flip that did not take becomes a reported give-up instead of a restart loop. Synchronous on
// purpose: the direction gate reads it before the first render. Adapter:
// kv-direction-guard-adapter.ts (expo-sqlite/kv-store). Fake: fake-direction-guard.ts.
import type { Result } from '@/core/result';
import type { Direction } from '@/i18n/languages';

export type DirectionGuardFailure = { readonly kind: 'direction-guard-not-saved' };

/**
 * What the guard knows about the last reload: the direction it was for, null when none is recorded
 * (or the stored value is not a direction), or 'unreadable' when the store could not be read. The
 * gate gives up on 'unreadable' instead of restarting: a guard it cannot read cannot stop a loop.
 */
export type PendingRestart = Direction | null | 'unreadable';

/** Reads and writes the pending direction synchronously; neither call throws. */
export type DirectionGuardPort = {
  readonly readPending: () => PendingRestart;
  /** Records the pending direction, or clears it with null. */
  readonly writePending: (direction: Direction | null) => Result<void, DirectionGuardFailure>;
};
