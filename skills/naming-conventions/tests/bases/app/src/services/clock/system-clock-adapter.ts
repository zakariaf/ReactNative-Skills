// src/services/clock/system-clock-adapter.ts
import type { ClockPort } from './clock-port';

export function createSystemClockAdapter(): ClockPort {
  return { now: () => Date.now() };
}
