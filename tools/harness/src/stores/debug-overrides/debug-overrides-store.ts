// src/stores/debug-overrides/debug-overrides-store.ts
// The one owner of the debug switches in a test build: hydrated synchronously from the test-only
// key-value store before the first paint, then every change is reduced, persisted, and only then
// published. Created once, by createTestHooks (the startup's test-only call); never at module level.
// Components read it through useDebugOverridesStore(selector) under TestHooksRoot, which fills
// DebugOverridesStoreContext.
import { createContext, use } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import {
  DEFAULT_DEBUG_OVERRIDES,
  decodeDebugOverrides,
  encodeDebugOverrides,
} from './debug-overrides';
import { debugOverridesReducer } from './debug-overrides-reducer';

import type { DebugOverrides } from './debug-overrides';
import type { DebugOverridesAction } from './debug-overrides-reducer';
import type {
  DebugStorageFailure,
  DebugStoragePort,
} from '@/services/debug-storage/debug-storage-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { StoreApi } from 'zustand/vanilla';

export type DebugOverridesState = {
  readonly overrides: DebugOverrides;
  /** false when the stored switches could not be read: this run keeps changes in memory only. */
  readonly isPersistent: boolean;
  /** Set when the last change could not be saved; null after a saved change. */
  readonly lastWriteFailure: DebugStorageFailure | null;
  readonly dispatch: (action: DebugOverridesAction) => void;
};

export type DebugOverridesStore = StoreApi<DebugOverridesState>;

export type DebugOverridesStoreDeps = {
  readonly storage: DebugStoragePort;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

type Hydrated = Pick<DebugOverridesState, 'overrides' | 'isPersistent'>;

/** Reads once; an unreadable store or text runs this session on the defaults and never writes. */
function hydrate({ storage, errorLog }: DebugOverridesStoreDeps): Hydrated {
  const read = storage.read();
  if (!read.ok) {
    errorLog.record('storage', new Error(read.error.kind));
    return { overrides: DEFAULT_DEBUG_OVERRIDES, isPersistent: false };
  }
  const decoded = decodeDebugOverrides(read.value);
  if (decoded.ok) return { overrides: decoded.value, isPersistent: true };
  errorLog.record('storage', new Error(decoded.error.kind));
  return { overrides: DEFAULT_DEBUG_OVERRIDES, isPersistent: true };
}

export function createDebugOverridesStore(deps: DebugOverridesStoreDeps): DebugOverridesStore {
  const { overrides, isPersistent } = hydrate(deps);
  return createStore<DebugOverridesState>()((set, get) => ({
    overrides,
    isPersistent,
    lastWriteFailure: null,
    dispatch: (action) => {
      const current = get().overrides;
      const next = debugOverridesReducer(current, action);
      if (next === current) return;
      if (isPersistent) {
        const written = deps.storage.write(encodeDebugOverrides(next));
        if (!written.ok) {
          deps.errorLog.record('storage', new Error(written.error.kind));
          set({ lastWriteFailure: written.error });
          return;
        }
      }
      set({ overrides: next, lastWriteFailure: null });
    },
  }));
}

/** Filled by TestHooksRoot in a test build; null outside it. */
export const DebugOverridesStoreContext = createContext<DebugOverridesStore | null>(null);

/** Primitives or references in the state: useDebugOverridesStore(selectIsMotionStill). */
export function useDebugOverridesStore<TSlice>(
  selector: (state: DebugOverridesState) => TSlice,
): TSlice {
  const store = use(DebugOverridesStoreContext);
  if (store === null) {
    throw new Error(
      'useDebugOverridesStore() needs <TestHooksRoot> above it (wire it in the root)',
    );
  }
  return useStore(store, selector);
}
