// src/services/direction-guard/kv-direction-guard-adapter.ts
// Stand-in for rtl-and-direction's adapter: the pending direction in expo-sqlite/kv-store, read
// synchronously on the first render.
import Storage from 'expo-sqlite/kv-store';

import { attempt } from '@/core/result';

import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';

export const PENDING_DIRECTION_KEY = 'direction.pending-restart';

export function createKvDirectionGuardAdapter(): DirectionGuardPort {
  return {
    readPending: () => {
      const read = attempt(() => Storage.getItemSync(PENDING_DIRECTION_KEY), () => ({ kind: 'direction-guard-unreadable' }) as const);
      return read.ok && (read.value === 'ltr' || read.value === 'rtl') ? read.value : read.ok ? null : 'unreadable';
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
