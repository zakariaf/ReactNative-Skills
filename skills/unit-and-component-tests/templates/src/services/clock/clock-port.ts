// src/services/clock/clock-port.ts
import type { DateKey } from '@/core/dates/date-key';

/**
 * The only source of wall-clock time in the app. Pure code never reads time: it receives values
 * (`nowMs`, a `DateKey`); screens, stores and services receive a ClockPort. Adapter:
 * system-clock-adapter.ts (the one app file that reads Date). Fake: fake-clock.ts.
 */
export type ClockPort = {
  /** Epoch milliseconds: timestamps, durations, rate limits. Never seeded or replayed logic. */
  readonly nowMs: () => number;
  /** Today's local calendar day 'YYYY-MM-DD'; changes at local midnight. */
  readonly today: () => DateKey;
  /**
   * Milliseconds until the next local midnight, when today() changes: at least 1, at most one
   * local day (86,400,000; 90,000,000 on the day clocks fall back). Drives "due today" refreshes
   * and countdowns; a test build's simulated clock keeps this value.
   */
  readonly msUntilNextLocalDay: () => number;
};
