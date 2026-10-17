// src/core/reminders/wall-clock.test.ts
import {
  berlin2026,
  havana2026,
  lordHowe2026,
  newYork2026,
  utcZone,
} from '@test/reminders/rule-zone';

import { instantOfWallClock } from './wall-clock';

const at = (hour: number, minute = 0): number => hour * 60 + minute;

describe('instantOfWallClock', () => {
  it('reads the wall clock in UTC as the instant itself', () => {
    expect(instantOfWallClock('2026-10-14', at(9, 30), utcZone)).toBe(Date.UTC(2026, 9, 14, 9, 30));
  });

  it('applies the offset in force on that day', () => {
    expect(instantOfWallClock('2026-01-15', at(9), berlin2026)).toBe(Date.UTC(2026, 0, 15, 8));
    expect(instantOfWallClock('2026-07-15', at(9), berlin2026)).toBe(Date.UTC(2026, 6, 15, 7));
    expect(instantOfWallClock('2026-07-15', at(9), newYork2026)).toBe(Date.UTC(2026, 6, 15, 13));
  });

  it('keeps 09:00 at 09:00 across the spring change: that local day lasts 23 hours', () => {
    const before = instantOfWallClock('2026-03-28', at(9), berlin2026);
    const after = instantOfWallClock('2026-03-29', at(9), berlin2026);

    expect([before, after]).toStrictEqual([Date.UTC(2026, 2, 28, 8), Date.UTC(2026, 2, 29, 7)]);
    expect(after - before).toBe(23 * 3_600_000);
  });

  it('keeps 09:00 at 09:00 across the autumn change: that local day lasts 25 hours', () => {
    const before = instantOfWallClock('2026-10-24', at(9), berlin2026);
    const after = instantOfWallClock('2026-10-25', at(9), berlin2026);

    expect(after - before).toBe(25 * 3_600_000);
  });

  it('moves a skipped time forward by the gap', () => {
    // 02:30 does not exist in Berlin on 29 March: it becomes 03:30 summer time.
    expect(instantOfWallClock('2026-03-29', at(2, 30), berlin2026)).toBe(
      Date.UTC(2026, 2, 29, 1, 30),
    );
    // 02:30 does not exist in New York on 8 March: it becomes 03:30 EDT.
    expect(instantOfWallClock('2026-03-08', at(2, 30), newYork2026)).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
    // Havana skips local midnight: 00:30 becomes 01:30 (UTC-4).
    expect(instantOfWallClock('2026-03-08', at(0, 30), havana2026)).toBe(
      Date.UTC(2026, 2, 8, 5, 30),
    );
  });

  it('takes the first of a time that happens twice', () => {
    // 02:30 happens twice in Berlin on 25 October: first in summer time (UTC+2).
    expect(instantOfWallClock('2026-10-25', at(2, 30), berlin2026)).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    );
    // 01:30 happens twice in New York on 1 November: first in EDT (UTC-4).
    expect(instantOfWallClock('2026-11-01', at(1, 30), newYork2026)).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    );
  });

  it('handles a half-hour change', () => {
    // Lord Howe goes from UTC+11 to UTC+10:30 at 02:00 local on 5 April: 01:45 happens twice.
    expect(instantOfWallClock('2026-04-05', at(1, 45), lordHowe2026)).toBe(
      Date.UTC(2026, 3, 4, 14, 45),
    );
    expect(instantOfWallClock('2026-04-06', at(9), lordHowe2026)).toBe(
      Date.UTC(2026, 3, 5, 22, 30),
    );
  });
});
