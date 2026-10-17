// src/core/dates/daily-seed.test.ts
// Golden values computed by an independent oracle (Python integers, FNV-1a written from its
// specification); seeded-determinism-and-golden-vectors documents the procedure. A diff here
// means every user gets different day-keyed content after the update.
import fc from 'fast-check';

import { dailySeed } from './daily-seed';
import { fromDayNumber } from './date-key';

const FNV_PRIME = 16_777_619;

describe('dailySeed', () => {
  it('pins the daily seed goldens (compatibility contract)', () => {
    expect(dailySeed('2026-09-26', 17)).toBe(2_599_028_541);
    expect(dailySeed('2026-09-27', 17)).toBe(2_582_250_922);
    expect(dailySeed('2027-01-01', 17)).toBe(2_349_681_313);
    expect(dailySeed('2026-09-26', 0)).toBe(2_362_601_272);
    expect(dailySeed('2028-02-29', 4242)).toBe(773_016_242);
  });

  it('gives a different seed for another day or another salt', () => {
    expect(dailySeed('2026-09-26', 18)).not.toBe(dailySeed('2026-09-26', 17));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.nat(0xffff), (days, salt) => {
        const seed = dailySeed(fromDayNumber(days), salt);
        expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff).toBe(true);
      }),
      { seed: 17, numRuns: 500 },
    );
  });

  it('shows why the raw seed is never used as a value: neighbours differ by the FNV prime', () => {
    // seedRng (src/core/rng/sfc32.ts) mixes it; the generator tests prove the mixed draws differ.
    expect(dailySeed('2026-09-26', 17) - dailySeed('2026-09-27', 17)).toBe(FNV_PRIME);
  });
});
