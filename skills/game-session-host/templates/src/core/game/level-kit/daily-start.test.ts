// src/core/game/level-kit/daily-start.test.ts
import { dailyStart } from './daily-start';

describe('dailyStart', () => {
  it('pins the daily seed for a date and salt (compatibility contract)', () => {
    const levels = { daily: { kind: 'daily', difficulty: 40, salt: 17 } } as const;
    expect(dailyStart(levels, '2026-09-26')).toStrictEqual({ seed: 2_599_028_541, difficulty: 40 });
    expect(dailyStart(levels, '2026-09-27')).toStrictEqual({ seed: 2_582_250_922, difficulty: 40 });
  });

  it('returns null for a game without a daily mode', () => {
    expect(dailyStart({ daily: { kind: 'none' } }, '2026-09-26')).toBeNull();
  });
});
