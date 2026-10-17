// src/services/clock/fake-clock.ts
import type { ClockPort } from './clock-port';

export function createFakeClock(start: number): ClockPort & { readonly advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}
