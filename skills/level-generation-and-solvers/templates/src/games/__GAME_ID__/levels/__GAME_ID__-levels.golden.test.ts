// src/games/__GAME_ID__/levels/__GAME_ID__-levels.golden.test.ts
// DATA GOLDEN. A diff here means players get different levels. Update only on purpose with
// `npx jest <this file> --selectProjects golden -u` and a `Gate-Change:` commit trailer.
// The daily goldens are a [contract] entry (registered in contracts/goldens.json): the board of
// an existing date never changes. dailyStart reads the LevelsSpec's daily salt and difficulty,
// so the goldens also pin the daily wiring the game screen uses.
import { dailyStart } from '@/core/game/level-kit/daily-start';
import { create } from '@/games/__GAME_ID__/rules/create';

import { describeLevel } from './__GAME_ID__-describe';
import { __GAME_CONST___LEVELS } from './__GAME_ID__-levels';

import type { DateKey } from '@/core/dates/date-key';

/** The frozen text of a level start: its seed and difficulty, then the game's own describeLevel. */
function describeStart(seed: number, difficulty: number): string {
  const head = `seed ${String(seed)} difficulty ${String(difficulty)}`;
  return `${head} ${describeLevel(create(seed, difficulty))}`;
}

describe('__GAME_ID__ level table goldens', () => {
  it.each([1, 30, 31, 60, 61, 90])('keeps the frozen board of level %i', (level) => {
    const entry = __GAME_CONST___LEVELS.table[level - 1];
    if (entry === undefined) throw new Error(`level ${String(level)} missing`);
    expect(
      `${describeStart(entry.seed, entry.difficulty)}\n${JSON.stringify(entry.stars)}`,
    ).toMatchSnapshot();
  });
});

describe('[contract] __GAME_ID__ daily goldens', () => {
  const dates: readonly DateKey[] = ['2026-09-28', '2026-12-31', '2027-01-01'];

  it.each(dates)('keeps the frozen daily board for %s', (date) => {
    const start = dailyStart(__GAME_CONST___LEVELS, date);
    if (start === null) throw new Error('the daily mode is off');
    expect(describeStart(start.seed, start.difficulty)).toMatchSnapshot();
  });
});
