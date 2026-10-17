// src/services/session/sign-out-step-factories.ts
// Ready-made sign-out steps. A step named `x-y` is made by `xYStep(...)` or written as
// `{ name: 'x-y', run }`; contracts/auth.json lists every name, and the checker finds each one where
// the app creates its session, so a cache nobody wired into sign-out is a finding, not a leak.
import type { SignOutStep } from './session-types';

/** The part of TanStack Query's QueryClient that sign-out needs. */
export type ClearableQueryCache = {
  readonly cancelQueries: () => Promise<void>;
  readonly clear: () => void;
};

/** Cancels every running query, then drops every cached query and mutation of the old account. */
export function queryCacheStep(cache: ClearableQueryCache): SignOutStep {
  return {
    name: 'query-cache',
    run: async () => {
      await cache.cancelQueries();
      cache.clear();
    },
  };
}

/** Puts a store holding per-account data back to its initial state (a Zustand store's reset). */
export function storeResetStep(name: string, reset: () => void): SignOutStep {
  return { name, run: reset };
}
