// src/core/countdown/split-countdown.test.ts
import fc from 'fast-check';

import { splitCountdown } from './split-countdown';

describe('splitCountdown', () => {
  it('splits the time to midnight into whole hours and minutes', () => {
    expect(splitCountdown(11_100_000)).toStrictEqual({ hours: 3, minutes: 5 });
  });

  it('rounds up, so the last seconds of the day still read one minute', () => {
    expect([splitCountdown(30_000), splitCountdown(3_600_001)]).toStrictEqual([
      { hours: 0, minutes: 1 },
      { hours: 1, minutes: 1 },
    ]);
  });

  it('reads 25 hours on the day the clocks fall back', () => {
    expect(splitCountdown(90_000_000)).toStrictEqual({ hours: 25, minutes: 0 });
  });

  it('reads zero at or past midnight, never a negative time', () => {
    expect([splitCountdown(0), splitCountdown(-5_000)]).toStrictEqual([
      { hours: 0, minutes: 0 },
      { hours: 0, minutes: 0 },
    ]);
  });

  it('keeps at least one minute while time is left', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 90_000_000 }), (msLeft) => {
        const { hours, minutes } = splitCountdown(msLeft);

        expect(hours * 60 + minutes).toBeGreaterThan(0);
        expect(minutes).toBeLessThan(60);
      }),
      { seed: 3, numRuns: 500 },
    );
  });
});
