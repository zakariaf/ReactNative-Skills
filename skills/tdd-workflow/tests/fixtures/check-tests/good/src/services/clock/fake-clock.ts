// src/services/clock/fake-clock.ts: fakes are logic too, with their own test.
export function createFakeClock(nowMs: number): { readonly nowMs: () => number } {
  return { nowMs: () => nowMs };
}
