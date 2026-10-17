// test/reminders/rule-zone.ts
// Time zones as data for reminder tests: an offset and the instants it changes. Jest runs with
// TZ=UTC, so daylight saving is tested here, never through the machine's zone. Each transition was
// checked against the IANA database through Node's Intl (timeZoneName 'longOffset', 2026-10-14);
// only the transitions the tests use are listed.
import type { OffsetAt } from '@/core/reminders/wall-clock';

export type ZoneTransition = {
  /** The UTC instant the new offset starts. */
  readonly atMs: number;
  /** Milliseconds east of UTC from then on. */
  readonly offsetMs: number;
};

const HOUR_MS = 3_600_000;

/** A zone that starts at `initialOffsetMs` and changes at each transition (oldest first). */
export function ruleZone(
  initialOffsetMs: number,
  transitions: readonly ZoneTransition[],
): OffsetAt {
  return (instantMs) => {
    let offsetMs = initialOffsetMs;
    for (const transition of transitions) {
      if (instantMs >= transition.atMs) offsetMs = transition.offsetMs;
    }
    return offsetMs;
  };
}

/** UTC all year. */
export const utcZone: OffsetAt = () => 0;

/** UTC+1, summer time (UTC+2) from 29 March 01:00 UTC to 25 October 01:00 UTC 2026. */
export const berlin2026 = ruleZone(HOUR_MS, [
  { atMs: Date.UTC(2026, 2, 29, 1), offsetMs: 2 * HOUR_MS },
  { atMs: Date.UTC(2026, 9, 25, 1), offsetMs: HOUR_MS },
]);

/** UTC-5, summer time (UTC-4) from 8 March 07:00 UTC to 1 November 06:00 UTC 2026. */
export const newYork2026 = ruleZone(-5 * HOUR_MS, [
  { atMs: Date.UTC(2026, 2, 8, 7), offsetMs: -4 * HOUR_MS },
  { atMs: Date.UTC(2026, 10, 1, 6), offsetMs: -5 * HOUR_MS },
]);

/** UTC+11 until 4 April 2026 15:00 UTC, then UTC+10:30: a half-hour change. */
export const lordHowe2026 = ruleZone(11 * HOUR_MS, [
  { atMs: Date.UTC(2026, 3, 4, 15), offsetMs: 10.5 * HOUR_MS },
]);

/** UTC-5; on 8 March 2026 local midnight jumps to 01:00 (UTC-4): the day has no 00:00-00:59. */
export const havana2026 = ruleZone(-5 * HOUR_MS, [
  { atMs: Date.UTC(2026, 2, 8, 5), offsetMs: -4 * HOUR_MS },
]);
