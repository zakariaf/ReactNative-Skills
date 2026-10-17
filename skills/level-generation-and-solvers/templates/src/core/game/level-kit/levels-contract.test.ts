// src/core/game/level-kit/levels-contract.test.ts
import { createBfsSolver } from '@/core/game/solver/engine-solver';

import { levelsContractProblems } from './levels-contract';

import type { LevelsSpec } from '@/core/game/levels';

/** Toy puzzle: walk from 0 to the target (3 + difficulty) in steps of 1 or 2. */
type Walk = { readonly at: number; readonly target: number };
const ENGINE = {
  create: (_seed: number, difficulty: number): Walk => ({ at: 0, target: 3 + difficulty }),
  listMoves: (state: Walk): readonly number[] => (state.at < state.target ? [1, 2] : []),
  applyMove: (state: Walk, step: number) => ({
    state: { ...state, at: state.at + step },
    events: [],
  }),
  outcome: (state: Walk) => {
    if (state.at === state.target) return { kind: 'won', score: 1 } as const;
    return state.at > state.target
      ? ({ kind: 'lost', reasonKey: 'demo.lose.overshot' } as const)
      : ({ kind: 'playing' } as const);
  },
};

const LEVELS: LevelsSpec<Walk, number> = {
  difficultyFor: (level) => level,
  packs: [
    { id: 'first', nameId: 'demo.pack.first', firstLevel: 1, levelCount: 2, starsToUnlock: 0 },
    { id: 'second', nameId: 'demo.pack.second', firstLevel: 3, levelCount: 2, starsToUnlock: 3 },
  ],
  table: [
    { level: 1, seed: 1, difficulty: 1, stars: { kind: 'par', par: 2 } },
    { level: 2, seed: 2, difficulty: 2, stars: { kind: 'par', par: 3 } },
    { level: 3, seed: 3, difficulty: 3, stars: { kind: 'par', par: 3 } },
    { level: 4, seed: 4, difficulty: 4, stars: { kind: 'par', par: 4 } },
  ],
  solver: createBfsSolver({ engine: ENGINE, key: (state) => String(state.at) }),
  daily: { kind: 'daily', difficulty: 2, salt: 9 },
  endless: { kind: 'none' },
};
const CONFIG = { packCount: 2, levelsPerPack: 2 };
const input = (levels: LevelsSpec<Walk, number>) => ({
  levels,
  engine: ENGINE,
  config: CONFIG,
  maxNodes: 1000,
});

describe('levelsContractProblems', () => {
  it('returns no problems for a consistent, solver-checked table', () => {
    expect(levelsContractProblems(input(LEVELS))).toStrictEqual([]);
  });

  it('reports a par that differs from the solver', () => {
    const table = LEVELS.table.map((entry) =>
      entry.level === 4 ? { ...entry, stars: { kind: 'par', par: 3 } as const } : entry,
    );
    expect(levelsContractProblems(input({ ...LEVELS, table }))).toStrictEqual([
      "level 4 par 3 differs from the solver's 4",
    ]);
  });

  it('reports gaps, curve drift and packs that do not match the config', () => {
    const table: LevelsSpec<Walk, number>['table'] = [
      { level: 1, seed: 1, difficulty: 1, stars: { kind: 'par', par: 2 } },
      { level: 3, seed: 3, difficulty: 9, stars: { kind: 'par', par: 3 } },
    ];
    const problems = levelsContractProblems(input({ ...LEVELS, table, solver: null }));
    expect(problems).toContain('table[1] is level 3, expected 2');
    expect(problems).toContain('level 3 difficulty 9 differs from difficultyFor (3)');
    expect(problems).toContain('packs cover 4 levels, the table has 2');
  });

  it('reports pack layouts that break the unlock rules', () => {
    const packs = [
      { id: 'First', nameId: 'demo.pack.first', firstLevel: 1, levelCount: 2, starsToUnlock: 3 },
      { id: 'second', nameId: 'demo.pack.second', firstLevel: 4, levelCount: 3, starsToUnlock: 1 },
    ];
    const problems = levelsContractProblems(input({ ...LEVELS, packs, solver: null }));
    expect(problems).toContain('pack id "First" is not kebab-case');
    expect(problems).toContain('pack second starts at 4, expected 3');
    expect(problems).toContain('pack second has 3 levels, the config says 2');
    expect(problems).toContain(
      'pack second needs 1 stars, the unlock rule gives 3 (half the stars of the packs before it)',
    );
    expect(problems).toContain('the first pack must need 0 stars');
  });

  it('reports a hand-written unlock that differs from half the stars before it', () => {
    const packs = LEVELS.packs.map((pack) =>
      pack.id === 'second' ? { ...pack, starsToUnlock: 2 } : pack,
    );
    expect(levelsContractProblems(input({ ...LEVELS, packs }))).toStrictEqual([
      'pack second needs 2 stars, the unlock rule gives 3 (half the stars of the packs before it)',
    ]);
  });

  it('accepts a daily-only game with no packs and no table', () => {
    const dailyOnly: LevelsSpec<Walk, number> = { ...LEVELS, packs: [], table: [], solver: null };
    expect(
      levelsContractProblems({ ...input(dailyOnly), config: { packCount: 0, levelsPerPack: 0 } }),
    ).toStrictEqual([]);
  });

  it('reports a repeated level and a pack count that differs from the config', () => {
    const table = LEVELS.table.map((entry) =>
      entry.level === 2 ? { ...entry, seed: 1, difficulty: 1 } : entry,
    );
    const problems = levelsContractProblems({
      ...input({ ...LEVELS, table, difficultyFor: () => 1, solver: null }),
      config: { packCount: 3, levelsPerPack: 2 },
    });
    expect(problems).toContain('level 2 repeats seed/difficulty 1/1');
    expect(problems).toContain('2 packs, the config says 3');
  });

  it('reports levels above 99 and an endless run off the endless difficulty', () => {
    const table = LEVELS.table.map((entry) =>
      entry.level === 4 ? { ...entry, difficulty: 100 } : entry,
    );
    const problems = levelsContractProblems(
      input({
        ...LEVELS,
        table,
        difficultyFor: (level) => (level === 4 ? 100 : level),
        daily: { kind: 'daily', difficulty: 120, salt: 9 },
        endless: { kind: 'endless', difficulty: 99 },
        solver: null,
      }),
    );
    expect(problems).toStrictEqual([
      'level 4 difficulty 100 is above 99 (100 is the endless run)',
      'the daily difficulty 120 is above 99',
      'the endless difficulty 99 is not ENDLESS_DIFFICULTY (100)',
    ]);
  });

  it('reports a level the solver cannot solve and a line that does not replay', () => {
    const stuck = { solve: () => ({ kind: 'unsolvable' }) as const };
    expect(levelsContractProblems(input({ ...LEVELS, solver: stuck }))).toContain(
      'level 1 is unsolvable',
    );
    const wrongLine = {
      solve: () => ({ kind: 'solved', par: 1, line: [5], final: { at: 5, target: 4 } }) as const,
    };
    expect(levelsContractProblems(input({ ...LEVELS, solver: wrongLine }))).toContain(
      'level 1: the solver line does not replay (illegal-move)',
    );
  });
});
