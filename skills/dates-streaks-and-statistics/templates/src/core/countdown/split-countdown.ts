// src/core/countdown/split-countdown.ts
// Pure: the time left until the user's local midnight (ClockPort.msUntilNextLocalDay()) as whole
// hours and minutes, for "New day in 3 h 5 min" or "Your streak ends in 40 min". It sits on its own
// so useNextDayCountdown() works in an app without streaks or statistics.

/** Whole hours and minutes of a time left, for "New day in {hours} h {minutes} min". */
export type Countdown = { readonly hours: number; readonly minutes: number };

const MINUTE_MS = 60_000;

/**
 * Splits ClockPort.msUntilNextLocalDay() into whole hours and minutes, rounded up to the minute,
 * so the line never reads "0 h 0 min" while today is still running (11,100,000 -> 3 h 5 min).
 */
export function splitCountdown(msLeft: number): Countdown {
  const totalMinutes = Math.max(0, Math.ceil(msLeft / MINUTE_MS));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
