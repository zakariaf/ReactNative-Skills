// src/core/dates/date-key.test.ts
// Pinned day numbers and weekdays were computed by an independent oracle (Python's datetime.date);
// the properties check every day between 1900 and 2400.
import fc from 'fast-check';

import { addDays, dayNumber, daysBetween, fromDayNumber, isDateKey, isoWeekday } from './date-key';

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

describe('date-key', () => {
  it('matches known day numbers', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2026-09-26')).toBe(20_722);
    expect(dayNumber('2000-03-01')).toBe(11_017);
    expect(dayNumber('1900-01-01')).toBe(-25_567);
    expect(dayNumber('2400-12-31')).toBe(157_419);
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-09-27', '2026-09-26')).toBe(-1);
  });

  it('names ISO weekdays (1 = Monday ... 7 = Sunday)', () => {
    expect(isoWeekday('1970-01-01')).toBe(4);
    expect(isoWeekday('2000-01-01')).toBe(6);
    expect(isoWeekday('2024-02-29')).toBe(4);
    expect(isoWeekday('2026-09-26')).toBe(6);
    expect(isoWeekday('2026-09-28')).toBe(1);
    expect(isoWeekday('1969-12-28')).toBe(7);
  });

  it('rejects keys that are not YYYY-MM-DD', () => {
    expect(dayNumber('2026-9-26')).toBeNaN();
    expect(dayNumber('26.09.2026')).toBeNaN();
    expect(dayNumber('x2026-09-26')).toBeNaN();
    expect(dayNumber('2026-09-26x')).toBeNaN();
    expect(dayNumber('2026-09-26T00:00:00Z')).toBeNaN();
  });

  it('accepts only real calendar days as date keys', () => {
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-9-26')).toBe(false);
  });

  it('returns January keys in the new year, never as month 13 of the old one', () => {
    expect(fromDayNumber(dayNumber('2027-01-15'))).toBe('2027-01-15');
  });

  it('returns every day number between 1900 and 2400 after a round trip', () => {
    fc.assert(
      fc.property(fc.integer({ min: -25_567, max: 157_419 }), (days) => {
        expect(dayNumber(fromDayNumber(days))).toBe(days);
      }),
      { seed: 11, numRuns: 2000 },
    );
  });

  it('returns only real calendar dates: month 01-12 and a day that month has', () => {
    fc.assert(
      fc.property(fc.integer({ min: -25_567, max: 157_419 }), (days) => {
        const key = fromDayNumber(days);
        const [year = 0, month = 0, day = 0] = key.split('-').map(Number);
        const monthLength = (DAYS_IN_MONTH[month - 1] ?? 0) + (month === 2 && isLeap(year) ? 1 : 0);
        expect(month >= 1 && month <= 12 && day >= 1 && day <= monthLength).toBe(true);
        expect(isDateKey(key)).toBe(true);
      }),
      { seed: 12, numRuns: 2000 },
    );
  });
});
