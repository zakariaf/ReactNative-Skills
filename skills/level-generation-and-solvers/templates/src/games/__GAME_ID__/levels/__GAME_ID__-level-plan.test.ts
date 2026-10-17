// src/games/__GAME_ID__/levels/__GAME_ID__-level-plan.test.ts
import {
  difficultyFor,
  LEVELS_PER_PACK,
  LEVEL_DIFFICULTY_CAP,
  minParFor,
  __GAME_CONST___LEVEL_PLAN,
} from './__GAME_ID__-level-plan';

const LEVELS = Array.from({ length: 3 * LEVELS_PER_PACK }, (_, index) => index + 1);

describe('difficultyFor', () => {
  it('rises from 0 at level 1 to the cap at the last level without ever falling', () => {
    const curve = LEVELS.map(difficultyFor);
    expect(curve[0]).toBe(0);
    expect(curve.at(-1)).toBe(LEVEL_DIFFICULTY_CAP);
    expect(curve).toStrictEqual([...curve].sort((a, b) => a - b));
  });

  it('clamps level numbers outside the table', () => {
    expect(difficultyFor(0)).toBe(0);
    expect(difficultyFor(500)).toBe(LEVEL_DIFFICULTY_CAP);
  });
});

describe('__GAME_CONST___LEVEL_PLAN', () => {
  it('asks more presses in later packs: 2, 3, then 4', () => {
    expect([1, 30, 31, 60, 61, 90].map(minParFor)).toStrictEqual([2, 2, 3, 3, 4, 4]);
  });

  it('rates a level against par and rejects one that is too easy for its pack', () => {
    const start = __GAME_CONST___LEVEL_PLAN.create(1, 40);
    const candidate = { level: 61, seed: 1, difficulty: 40, start, line: [], final: start };
    expect(__GAME_CONST___LEVEL_PLAN.rate({ ...candidate, par: 5 })).toStrictEqual({
      kind: 'par',
      par: 5,
    });
    expect(__GAME_CONST___LEVEL_PLAN.rate({ ...candidate, par: 3 })).toBeNull();
  });

  it('declares three packs of thirty levels', () => {
    expect(__GAME_CONST___LEVEL_PLAN.packs).toHaveLength(3);
    expect(__GAME_CONST___LEVEL_PLAN.levelsPerPack).toBe(30);
  });
});
