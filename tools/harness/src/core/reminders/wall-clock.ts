// src/core/reminders/wall-clock.ts
// Turns a local day and a wall-clock minute into the instant it happens, given only the zone's
// offset at an instant (LocalZonePort.offsetAt on a device, a rule zone in tests). It never reads
// a clock, so it gives the same answer in Jest, in Node and on Hermes. Daylight saving rules:
// - a time the clocks skip (02:30 on a spring-forward night) moves forward by the gap (03:30);
// - a time that happens twice (02:30 on a fall-back night) takes the first occurrence.
// Both match ECMAScript's `new Date(y, m, d, h, min)` and Temporal's "compatible" choice.
import { dayNumber } from '@/core/dates/date-key';

import type { DateKey } from '@/core/dates/date-key';

/** Milliseconds east of UTC that the zone uses at an instant (Berlin in summer: 7_200_000). */
export type OffsetAt = (instantMs: number) => number;

const MINUTE_MS = 60_000;
// not-a-calendar-day: the epoch day number times a fixed 24 h gives the UTC wall reading of the
// day's midnight; the zone offset is applied afterwards, so no local day length is assumed.
const UTC_DAY_MS = 86_400_000;
/** Far enough from the wall time to sample the offset on each side of a nearby transition. */
const PROBE_MS = 26 * 3_600_000;

/**
 * The instant at which the local wall clock shows `minuteOfDay` on `day`. The caller validates
 * both (isDateKey, isMinuteOfDay). Never `nowMs + 24 h`: a local day lasts 23, 24 or 25 hours.
 */
export function instantOfWallClock(day: DateKey, minuteOfDay: number, offsetAt: OffsetAt): number {
  const wallMs = dayNumber(day) * UTC_DAY_MS + minuteOfDay * MINUTE_MS;
  const offsetBefore = offsetAt(wallMs - PROBE_MS);
  const offsetAfter = offsetAt(wallMs + PROBE_MS);
  const candidates = [wallMs - offsetBefore, wallMs - offsetAfter];
  const valid = candidates.filter((instantMs) => offsetAt(instantMs) === wallMs - instantMs);
  if (valid.length > 0) return Math.min(...valid);
  // The wall time does not exist (skipped): keep the offset from before the jump, which lands
  // the same distance after it.
  return wallMs - offsetBefore;
}
