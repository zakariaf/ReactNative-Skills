// src/services/clock/local-date.test.ts
// It holds in any time zone: run it with TZ=America/Los_Angeles and TZ=Pacific/Kiritimati too.
import { addDays } from '@/core/dates/date-key';

import { dateKeyOfLocalDate, localNoonOfDateKey } from './local-date';

describe('local-date', () => {
  it('shows a key as local noon of that same day', () => {
    const date = localNoonOfDateKey('2026-10-03');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toStrictEqual([
      2026, 9, 3, 12,
    ]);
  });

  it('returns every day of a leap year unchanged after a round trip, DST changes included', () => {
    for (let offset = 0; offset < 366; offset += 1) {
      const key = addDays('2028-01-01', offset);
      expect(dateKeyOfLocalDate(localNoonOfDateKey(key))).toBe(key);
    }
  });

  it('keeps years below 100 and pads them to four digits', () => {
    expect(dateKeyOfLocalDate(localNoonOfDateKey('0099-12-31'))).toBe('0099-12-31');
  });

  it('reads the local day of a picker result late in the evening', () => {
    expect(dateKeyOfLocalDate(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });
});
