// src/core/time/instant.ts
// An instant (a moment: created, reminded, synced) is an integer count of milliseconds since the Unix
// epoch, UTC by definition, named `<what>AtMs` in code and `<what>_at_ms INTEGER` in SQLite. ISO 8601
// text exists only at the wire (an API, an export), always with `Z` or an offset, and converts here,
// once, at the boundary. Text without an offset is local time on some unknown phone: refused, never
// guessed. A calendar day is not an instant: it is a local DateKey (dates-streaks-and-statistics).
// Pure arithmetic: no Date object is created here (core code never touches the wall clock).
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

export type InstantFailure =
  | { readonly kind: 'not-an-instant'; readonly text: string }
  | { readonly kind: 'date-only'; readonly text: string }
  | { readonly kind: 'missing-offset'; readonly text: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// RFC 3339 allows a lower-case 't' and 'z'.
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
// The wire form has four-digit years: 0000-01-01T00:00:00.000Z to 9999-12-31T23:59:59.999Z.
const MIN_WIRE_MS = -62_167_219_200_000;
const MAX_WIRE_MS = 253_402_300_799_999;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const UTC_DAY_MS = 86_400_000;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

type Fields = readonly [
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

function hasValidDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's days_from_civil). Not Date.UTC,
 * which maps the years 0-99 to 1900-1999.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const marchYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(marchYear / 400);
  const yearOfEra = marchYear - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** Minutes east of UTC for 'Z', '+05:30', '-0800'; null when the offset is out of range. */
function offsetMinutes(offset: string): number | null {
  if (offset === 'Z' || offset === 'z') return 0;
  const digits = offset.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > 23 || minutes > 59) return null;
  return (offset.startsWith('-') ? -1 : 1) * (hours * 60 + minutes);
}

/**
 * Epoch ms of a matched ISO text with an offset, or null when a field is out of range or the moment
 * falls outside the years toIsoInstant writes (so every accepted text round-trips).
 */
function instantOf(match: RegExpExecArray, offset: string): number | null {
  const field = (group: number): number => Number(match[group] ?? '0');
  const fields: Fields = [field(1), field(2), field(3), field(4), field(5), field(6)];
  const [year, month, day, hour, minute, second] = fields;
  const shift = offsetMinutes(offset);
  if (shift === null || !hasValidDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  const clock = hour * HOUR_MS + (minute - shift) * MINUTE_MS + second * 1000 + millis;
  const atMs = daysFromCivil(year, month, day) * UTC_DAY_MS + clock;
  return atMs < MIN_WIRE_MS || atMs > MAX_WIRE_MS ? null : atMs;
}

/**
 * '2026-10-10T08:30:00Z', '2026-10-10T10:30:00.250+02:00' -> epoch ms. A date alone is a
 * 'date-only' failure (it is a DateKey); a time without an offset is 'missing-offset'.
 */
export function parseIsoInstant(text: string): Result<number, InstantFailure> {
  if (DATE_ONLY.test(text)) return err({ kind: 'date-only', text });
  const match = ISO_INSTANT.exec(text);
  const offset = match?.[8];
  if (match !== null && offset === undefined) return err({ kind: 'missing-offset', text });
  const atMs = match === null || offset === undefined ? null : instantOf(match, offset);
  return atMs === null ? err({ kind: 'not-an-instant', text }) : ok(atMs);
}

/** [year, month, day] of a count of days since 1970-01-01 (H. Hinnant's civil_from_days). */
function civilFromDays(days: number): readonly [number, number, number] {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** Epoch ms -> '2026-10-10T08:30:00.000Z' (UTC, millisecond precision): the only wire form. */
export function toIsoInstant(atMs: number): string {
  if (!Number.isSafeInteger(atMs) || atMs < MIN_WIRE_MS || atMs > MAX_WIRE_MS) {
    throw new RangeError(
      `An instant on the wire is whole epoch ms in years 0000-9999, got ${String(atMs)}`,
    );
  }
  // not-a-calendar-day: the UTC date of an instant, written for the wire (ISO 8601 with Z).
  const days = Math.floor(atMs / UTC_DAY_MS);
  const msOfDay = atMs - days * UTC_DAY_MS;
  const [year, month, day] = civilFromDays(days);
  const time = [
    Math.floor(msOfDay / HOUR_MS),
    Math.floor(msOfDay / MINUTE_MS) % 60,
    Math.floor(msOfDay / 1000) % 60,
  ];
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${time.map((part) => pad(part, 2)).join(':')}.${pad(msOfDay % 1000, 3)}Z`;
}

/** Epoch seconds (many APIs, JWT `exp`) -> epoch ms. Seconds are converted here, never stored. */
export function instantFromEpochSeconds(seconds: number): number {
  const atMs = seconds * 1000;
  if (!Number.isSafeInteger(seconds) || atMs < MIN_WIRE_MS || atMs > MAX_WIRE_MS) {
    throw new RangeError(
      `Epoch seconds are whole and inside years 0000-9999, got ${String(seconds)}`,
    );
  }
  return atMs;
}
