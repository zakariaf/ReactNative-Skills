// src/i18n/format-date.ts
// The app's day-month labels. Labels are catalog messages: month and weekday names are copied from
// CLDR into the catalogs and the day is a typed number, so the digits follow the locale tag on
// Hermes and in Jest alike, with no DateTimeFormat polyfill to load. Times of day and other shapes
// use Intl.DateTimeFormat in src/i18n/ only, with calendar: 'gregory', an explicit timeZone and the
// forced FormatJS DateTimeFormat polyfill (the polyfill-locales rule then requires its block):
// native Hermes ignores -u-nu-, and on iOS it formats some locales (fa) in their local calendar.
// Keys are literals, never built.
import { isoWeekday } from '@/core/dates/date-key';

import type { TFunction } from './create-t';
import type { MessageKey } from './messages';
import type { DateKey } from '@/core/dates/date-key';

const MONTH_SHORT_KEYS = [
  'date.month-short.1',
  'date.month-short.2',
  'date.month-short.3',
  'date.month-short.4',
  'date.month-short.5',
  'date.month-short.6',
  'date.month-short.7',
  'date.month-short.8',
  'date.month-short.9',
  'date.month-short.10',
  'date.month-short.11',
  'date.month-short.12',
] as const satisfies readonly MessageKey[];

// Indexed by isoWeekday(date) - 1 (1 = Monday).
const WEEKDAY_KEYS = [
  'date.weekday.1',
  'date.weekday.2',
  'date.weekday.3',
  'date.weekday.4',
  'date.weekday.5',
  'date.weekday.6',
  'date.weekday.7',
] as const satisfies readonly MessageKey[];

function monthOf(date: DateKey): number {
  return Number(date.slice(5, 7));
}

function dayOf(date: DateKey): number {
  return Number(date.slice(8, 10));
}

/** '2026-09-26' -> 'Sep' / 'سبتمبر'. */
export function formatMonthShort(date: DateKey, t: TFunction): string {
  return t(MONTH_SHORT_KEYS[monthOf(date) - 1] ?? 'date.month-short.1');
}

/** '2026-09-26' -> 'Saturday' / 'السبت' (screen-reader names, headings). */
export function formatWeekdayName(date: DateKey, t: TFunction): string {
  return t(WEEKDAY_KEYS[isoWeekday(date) - 1] ?? 'date.weekday.1');
}

/**
 * '2026-09-26' -> '26 Sep' / '٢٦ سبتمبر'. The month comes back isolated (FSI…PDI): pass the result
 * into another message only as stripIsolates(formatDayMonth(…)), or the nested isolates can reorder
 * the date inside a right-to-left sentence.
 */
export function formatDayMonth(date: DateKey, t: TFunction): string {
  return t('date.day-month', { day: dayOf(date), monthName: formatMonthShort(date, t) });
}

/** '2026-09-26' -> 'Saturday, 26 Sep'. Isolated inside, like formatDayMonth. */
export function formatWeekdayDayMonth(date: DateKey, t: TFunction): string {
  return t('date.weekday-day-month', {
    weekdayName: formatWeekdayName(date, t),
    day: dayOf(date),
    monthName: formatMonthShort(date, t),
  });
}
