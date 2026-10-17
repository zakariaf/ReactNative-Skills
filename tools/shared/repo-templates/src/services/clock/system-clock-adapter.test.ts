// src/services/clock/system-clock-adapter.test.ts
// allow-fake-timers: the adapter is the app's one reader of Date, so Jest's fake Date is its input.
// These tests hold in any time zone the machine has (the countdown ends exactly when today() changes).
import { addDays } from '@/core/dates/date-key';

import { createSystemClockAdapter } from './system-clock-adapter';

/** 2026-09-26 12:00 UTC. */
const START_MS = 1_790_424_000_000;
const HOUR_MS = 3_600_000;

describe('createSystemClockAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: START_MS });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads epoch milliseconds from the system clock', () => {
    expect(createSystemClockAdapter().nowMs()).toBe(START_MS);
  });

  it('formats today as a zero-padded YYYY-MM-DD key', () => {
    expect(createSystemClockAdapter().today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('counts down at most one local day', () => {
    const left = createSystemClockAdapter().msUntilNextLocalDay();

    expect(left).toBeGreaterThanOrEqual(1);
    expect(left).toBeLessThanOrEqual(25 * HOUR_MS);
  });

  it('keeps today until the countdown ends, then moves to the next day', () => {
    const clock = createSystemClockAdapter();
    const today = clock.today();
    const left = clock.msUntilNextLocalDay();

    jest.setSystemTime(START_MS + left - 1);
    expect(clock.today()).toBe(today);
    expect(clock.msUntilNextLocalDay()).toBe(1);

    jest.setSystemTime(START_MS + left);
    expect(clock.today()).toBe(addDays(today, 1));
    expect(clock.msUntilNextLocalDay()).toBeGreaterThanOrEqual(23 * HOUR_MS);
  });
});
