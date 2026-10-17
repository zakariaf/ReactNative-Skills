// src/services/direction-guard/kv-direction-guard-adapter.ts
// The DirectionGuardPort on expo-sqlite/kv-store: a tiny key-value database apart from the app's
// data, readable synchronously before the first render, so nothing the app owns is opened or
// written before the direction is decided. Its test runs kv-store's real SQL on node:sqlite
// (test/direction-guard/kv-direction-guard-adapter.test.ts).
import Storage from 'expo-sqlite/kv-store';

import { attempt } from '@/core/result';

import type { Direction } from '@/i18n/languages';
import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';

/** The kv-store key; namespaced so it never collides with the app's own preferences. */
export const PENDING_DIRECTION_KEY = 'direction.pending-restart';

function asDirection(value: string | null): Direction | null {
  return value === 'ltr' || value === 'rtl' ? value : null;
}

export function createKvDirectionGuardAdapter(): DirectionGuardPort {
  return {
    readPending: () => {
      const read = attempt(
        () => Storage.getItemSync(PENDING_DIRECTION_KEY),
        () => ({ kind: 'direction-guard-unreadable' }) as const,
      );
      // A failed read is not "nothing pending": reporting it lets the gate give up instead of looping.
      return read.ok ? asDirection(read.value) : 'unreadable';
    },
    writePending: (direction) =>
      attempt(
        () => {
          if (direction === null) Storage.removeItemSync(PENDING_DIRECTION_KEY);
          else Storage.setItemSync(PENDING_DIRECTION_KEY, direction);
        },
        () => ({ kind: 'direction-guard-not-saved' }) as const,
      ),
  };
}
