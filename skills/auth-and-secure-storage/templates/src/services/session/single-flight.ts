// src/services/session/single-flight.ts
// Two small tools the session manager is built from. A Cell holds one mutable value behind get/set,
// so state changes are calls, not property writes on a shared object. singleFlight starts a piece of
// async work once and hands the same promise to every caller until it settles: one refresh for ten
// requests that need a token at the same moment, one sign-out for two taps.

/** One mutable value, changed only by calling `set`. */
export type Cell<TValue> = { readonly get: () => TValue; readonly set: (value: TValue) => void };

export function cell<TValue>(initial: TValue): Cell<TValue> {
  let value = initial;
  return {
    get: () => value,
    set: (replacement) => {
      value = replacement;
    },
  };
}

/** Starts `work` unless a run is in flight; every caller meanwhile shares the same promise. */
export function singleFlight<TValue>(
  slot: Cell<Promise<TValue> | null>,
  work: () => Promise<TValue>,
): Promise<TValue> {
  const running = slot.get();
  if (running !== null) return running;
  const started = work().finally(() => {
    slot.set(null);
  });
  slot.set(started);
  return started;
}
