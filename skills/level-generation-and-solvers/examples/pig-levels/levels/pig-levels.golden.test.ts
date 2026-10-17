// src/games/pig/levels/pig-levels.golden.test.ts
// DATA GOLDEN. A diff here means players get different levels. Update only on purpose with
// `npx jest <this file> --selectProjects golden -u` and a `Gate-Change:` commit trailer.
import { dailyStart } from '@/core/game/level-kit/daily-start';
import { PIG_ENGINE } from '@/games/pig/rules/pig-engine';

import { describeLevel } from './pig-describe';
import { PIG_LEVELS } from './pig-levels';

import type { DateKey } from '@/core/dates/date-key';

function describeStart(seed: number, difficulty: number): string {
  const head = `seed ${String(seed)} difficulty ${String(difficulty)}`;
  return `${head} ${describeLevel(PIG_ENGINE.create(seed, difficulty))}`;
}

describe('pig level table goldens', () => {
  it.each([1, 20, 21, 40])('keeps the frozen start of level %i', (level) => {
    const entry = PIG_LEVELS.table[level - 1];
    if (entry === undefined) throw new Error(`level ${String(level)} missing`);
    expect(
      `${describeStart(entry.seed, entry.difficulty)}\n${JSON.stringify(entry.stars)}`,
    ).toMatchSnapshot();
  });
});

describe('[contract] pig daily goldens', () => {
  const dates: readonly DateKey[] = ['2026-09-28', '2026-12-31', '2027-01-01'];

  it.each(dates)('keeps the frozen daily start for %s', (date) => {
    const start = dailyStart(PIG_LEVELS, date);
    if (start === null) throw new Error('the daily mode is off');
    expect(describeStart(start.seed, start.difficulty)).toMatchSnapshot();
  });
});
