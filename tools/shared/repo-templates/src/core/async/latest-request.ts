// src/core/async/latest-request.ts
// Latest-wins for overlapping calls of one action that is not server state (the async-safety skill
// owns this file): search as you type over on-device data, a filter switch over a SQLite
// repository, a refresh of a native SDK read, the first read of an OS value racing its change
// event. Starting a request aborts the one before it, so its signal does two jobs: work that
// accepts a signal (the app's ports, an SDK call that takes one) stops, and code that cannot be
// stopped (a SQLite query) checks `signal.aborted` after its await and drops its result. Server
// data needs none of this: a useQuery key already gives latest-wins (networking-and-server-state).
// The last answer to arrive is not the last one asked for. No timers, no React, no platform imports.

/** One current request per action: starting a new one aborts the previous one. */
export type LatestRequest = {
  /** Aborts the previous request and returns the signal of the new one. */
  readonly start: () => AbortSignal;
  /** Aborts the current request, if any (unmount, blur, dispose, a newer event). */
  readonly cancel: () => void;
};

/** Creates the holder: one per action, in a service or a `useState` initializer, never a store. */
export function createLatestRequest(): LatestRequest {
  let current: AbortController | null = null;
  return {
    start: () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return controller.signal;
    },
    cancel: () => {
      current?.abort();
      current = null;
    },
  };
}
