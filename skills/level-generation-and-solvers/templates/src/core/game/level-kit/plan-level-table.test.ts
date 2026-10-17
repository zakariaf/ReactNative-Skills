// src/core/game/level-kit/plan-level-table.test.ts
import { createBfsSolver } from '@/core/game/solver/engine-solver';

import { candidateSeed, packsOf, planLevelTable } from './plan-level-table';

import type { LevelPlan } from './level-plan';

/** Toy puzzle: walk from 0 to the target in steps of 1 or 2; the seed picks the target. */
type Walk = { readonly at: number; readonly target: number };
const ENGINE = {
  listMoves: (state: Walk): readonly number[] => (state.at < state.target ? [1, 2] : []),
  applyMove: (state: Walk, step: number) => ({
    state: { ...state, at: state.at + step },
    events: [],
  }),
  outcome: (state: Walk) => {
    if (state.at === state.target) return { kind: 'won', score: 1 } as const;
    return state.at > state.target
      ? ({ kind: 'lost', reasonKey: 'walk.lose.overshot' } as const)
      : ({ kind: 'playing' } as const);
  },
};

const PLAN: LevelPlan<Walk, number> = {
  gameId: 'walk',
  packs: [
    { id: 'first', nameId: 'walk.pack.first' },
    { id: 'second', nameId: 'walk.pack.second' },
  ],
  levelsPerPack: 3,
  difficultyFor: (level) => level * 10,
  create: (seed, difficulty) => ({ at: 0, target: 2 + (seed % 5) + difficulty / 10 }),
  solver: createBfsSolver({ engine: ENGINE, key: (state) => String(state.at) }),
  maxNodes: 1000,
  maxTries: 20,
  rate: ({ par }) => (par >= 2 ? { kind: 'par', par } : null),
};

describe('planLevelTable', () => {
  it('fills every pack in level order with solver-rated, distinct levels', () => {
    const { packs, failures } = planLevelTable(PLAN);
    expect(failures).toStrictEqual([]);
    expect(packs.map((pack) => pack.map((entry) => entry.level))).toStrictEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const boards = packs.flat().map((entry) => PLAN.create(entry.seed, entry.difficulty));
    expect(new Set(boards.map((board) => JSON.stringify(board))).size).toBe(6);
  });

  it('hands rate the solver line and the state it ends in', () => {
    const seen: unknown[] = [];
    planLevelTable({
      ...PLAN,
      packs: PLAN.packs.slice(0, 1),
      levelsPerPack: 1,
      rate: ({ par, line, final }) => {
        seen.push({ par, line, final });
        return { kind: 'score', thresholds: [0, final.at, final.at + 1] };
      },
    });
    expect(seen).toStrictEqual([{ par: 3, line: [2, 2, 2], final: { at: 6, target: 6 } }]);
  });

  it('records the difficulty curve and the par the solver found', () => {
    const [first] = planLevelTable(PLAN).packs[0] ?? [];
    if (first === undefined) throw new Error('level 1 missing');
    const start = PLAN.create(first.seed, first.difficulty);
    expect(first.difficulty).toBe(10);
    expect(first.stars).toStrictEqual({ kind: 'par', par: Math.ceil(start.target / 2) });
  });

  it('gives the same table on every run', () => {
    expect(planLevelTable(PLAN)).toStrictEqual(planLevelTable(PLAN));
  });

  it('reports a level whose candidates are all rejected', () => {
    const picky = { ...PLAN, rate: () => null };
    expect(planLevelTable(picky).failures[0]).toStrictEqual({ level: 1, tries: 20 });
  });

  it('skips a candidate whose board repeats an earlier level', () => {
    const sameBoard = { ...PLAN, create: () => ({ at: 0, target: 4 }), maxTries: 3 };
    const { packs, failures } = planLevelTable(sameBoard);
    expect(packs.flat()).toHaveLength(1);
    expect(failures.map((failure) => failure.level)).toStrictEqual([2, 3, 4, 5, 6]);
  });

  it('skips candidates the solver cannot finish within the budget', () => {
    const starved = { ...PLAN, maxNodes: 0, maxTries: 2 };
    expect(planLevelTable(starved).failures).toHaveLength(6);
  });

  it('lays packs out as consecutive ranges that unlock by half the earlier stars', () => {
    expect(packsOf(PLAN)).toStrictEqual([
      { id: 'first', nameId: 'walk.pack.first', firstLevel: 1, levelCount: 3, starsToUnlock: 0 },
      { id: 'second', nameId: 'walk.pack.second', firstLevel: 4, levelCount: 3, starsToUnlock: 4 },
    ]);
  });

  it('pins the candidate seed hash (a changed hash regenerates every table)', () => {
    expect(candidateSeed('walk', 1, 0)).toBe(GOLDEN_WALK_SEED);
  });
});

const GOLDEN_WALK_SEED = 1_752_753_323;
