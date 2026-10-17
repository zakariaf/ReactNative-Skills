// examples/local-date.ts — the shape of src/services/clock/local-date.ts (requested from
// architecture-and-boundaries, which owns src/services/clock/; write it there until it ships).
// The one place a picker's Date becomes a DateKey and a DateKey becomes a Date a picker can show.
// The clock folder is exempt from check-calendar-code's local-day-key rule for exactly this reason.
import type { DateKey } from '@/core/dates/date-key';

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * The local calendar day a Date falls on: a date picker's result as a DateKey.
 * Never `date.toISOString().slice(0, 10)`: that is the day in London.
 */
export function dateKeyOfLocalDate(date: Date): DateKey {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * Local noon of a key the caller validated with isDateKey: the Date a picker shows for that day.
 * Never `new Date(key)` or `Date.parse(key)`: a date-only string is UTC midnight, which is the
 * previous day everywhere west of UTC. Noon keeps clear of midnights that DST skips.
 */
export function localNoonOfDateKey(key: DateKey): Date {
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  return date;
}
