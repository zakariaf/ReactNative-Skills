// src/services/direction-guard/fake-direction-guard.ts
// In-memory DirectionGuardPort for tests: seed the pending direction, make reads or writes fail, and
// read back every write in order.
import { err, ok } from '@/core/result';

import type { Direction } from '@/i18n/languages';
import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';

export type FakeDirectionGuard = DirectionGuardPort & {
  /** Every value written (null clears), oldest first. */
  readonly writes: readonly (Direction | null)[];
};

export type FakeDirectionGuardOptions = {
  readonly pending?: Direction | null;
  readonly isWriteFailing?: boolean;
  /** Every read reports 'unreadable', as a kv-store that cannot be read does. */
  readonly isReadFailing?: boolean;
};

export function createFakeDirectionGuard(
  options: FakeDirectionGuardOptions = {},
): FakeDirectionGuard {
  let pending = options.pending ?? null;
  const writes: (Direction | null)[] = [];
  return {
    writes,
    readPending: () => (options.isReadFailing === true ? 'unreadable' : pending),
    writePending: (direction) => {
      if (options.isWriteFailing === true) return err({ kind: 'direction-guard-not-saved' });
      pending = direction;
      writes.push(direction);
      return ok(undefined);
    },
  };
}
