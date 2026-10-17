// src/core/dates/date-key.ts
// Pure calendar arithmetic on civil-date keys ('YYYY-MM-DD'): integer maths only, no Date, no time
// zone. Algorithm: H. Hinnant, "chrono-Compatible Low-Level Date Algorithms" (days_from_civil).

/** A civil (local calendar) day, 'YYYY-MM-DD': a day identity, never an instant. */
export type DateKey = string;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** Days since 1970-01-01; NaN unless the key has the 'YYYY-MM-DD' shape (see isDateKey). */
export function dayNumber(key: DateKey): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match === null) return Number.NaN;
  const [, y, m, d] = match.map(Number);
  if (y === undefined || m === undefined || d === undefined) return Number.NaN;
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Inverse of dayNumber (civil_from_days). */
export function fromDayNumber(days: number): DateKey {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** True for a real calendar day in 'YYYY-MM-DD' form ('2026-02-30' and '2026-9-26' are not). */
export function isDateKey(text: string): boolean {
  const days = dayNumber(text);
  return !Number.isNaN(days) && fromDayNumber(days) === text;
}

/** The civil day `days` after `key` (negative: before); integer maths, so DST never shifts it. */
export function addDays(key: DateKey, days: number): DateKey {
  return fromDayNumber(dayNumber(key) + days);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday (1970-01-01, day 0, was a Thursday). */
export function isoWeekday(key: DateKey): number {
  return ((((dayNumber(key) + 3) % 7) + 7) % 7) + 1;
}

/** b - a in whole days. */
export function daysBetween(a: DateKey, b: DateKey): number {
  return dayNumber(b) - dayNumber(a);
}
