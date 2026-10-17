// src/core/game/level-kit/level-table.test.ts
import { toLevelEntries } from './level-table';

const GOOD = [
  { level: 1, seed: 7, difficulty: 0, stars: { kind: 'par', par: 4 } },
  {
    level: 2,
    seed: 4_294_967_295,
    difficulty: 100,
    stars: { kind: 'score', thresholds: [0, 5, 9] },
  },
];

describe('toLevelEntries', () => {
  it('returns a valid table unchanged and typed', () => {
    expect(toLevelEntries(GOOD)).toStrictEqual(GOOD);
  });

  it.each([
    ['a non-array', { level: 1 }],
    ['a seed above uint32', [{ ...GOOD[0], seed: 4_294_967_296 }]],
    ['a difficulty above 100', [{ ...GOOD[0], difficulty: 101 }]],
    ['par 0', [{ ...GOOD[0], stars: { kind: 'par', par: 0 } }]],
    ['thresholds out of order', [{ ...GOOD[0], stars: { kind: 'score', thresholds: [5, 5, 9] } }]],
    ['an unknown star kind', [{ ...GOOD[0], stars: { kind: 'time', limit: 3 } }]],
  ])('throws a RangeError for %s', (_name, json) => {
    expect(() => toLevelEntries(json)).toThrow(RangeError);
  });
});
