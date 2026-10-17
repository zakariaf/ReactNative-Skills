// src/services/test-hooks/simulated-clock.ts
// The test build's clock: the real ClockPort with today() replaced while a simulated day is set (the
// debug link's date=, the debug menu's day buttons). nowMs() and msUntilNextLocalDay() stay real, so
// timers, timestamps and the next-day countdown never jump, and a screen's useToday() still turns
// at the real midnight. The composition root hands this wrapper to every service, so the whole app
// sees one day.
import type { DateKey } from '@/core/dates/date-key';
import type { ClockPort } from '@/services/clock/clock-port';

/** Wraps `real`; `simulatedToday()` is read on every call, so a change applies at once. */
export function createSimulatedClock(
  real: ClockPort,
  simulatedToday: () => DateKey | null,
): ClockPort {
  return {
    nowMs: () => real.nowMs(),
    today: () => simulatedToday() ?? real.today(),
    msUntilNextLocalDay: () => real.msUntilNextLocalDay(),
  };
}
