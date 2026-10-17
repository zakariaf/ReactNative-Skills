// src/games/pig/levels/pig-solver.test.ts
import fc from 'fast-check';

import { verifyLine } from '@/core/game/solver/verify-line';
import { PIG_ENGINE } from '@/games/pig/rules/pig-engine';

import { PIG_SOLVER, WITNESS_MAX_MOVES } from './pig-solver';

describe('PIG_SOLVER', () => {
  it('proves a level with a line the real engine replays as a win', () => {
    const start = PIG_ENGINE.create(3, 0);
    const result = PIG_SOLVER.solve(start, WITNESS_MAX_MOVES);
    if (result.kind !== 'solved') throw new Error(`expected a win, got ${result.kind}`);
    expect(result.par).toBe(result.line.length);
    expect(verifyLine(PIG_ENGINE, start, result.line)).toStrictEqual({
      kind: 'wins',
      moves: result.par,
    });
  });

  it('reports a start the witness loses as budget-exceeded, never unsolvable', () => {
    const lost = { ...PIG_ENGINE.create(1, 0), busts: 3 };
    expect(PIG_SOLVER.solve(lost, WITNESS_MAX_MOVES)).toStrictEqual({ kind: 'budget-exceeded' });
  });

  it('gives the same answer for the same start, and every win replays', () => {
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 0, max: 99 }), (seed, difficulty) => {
        const start = PIG_ENGINE.create(seed, difficulty);
        const result = PIG_SOLVER.solve(start, WITNESS_MAX_MOVES);
        expect(PIG_SOLVER.solve(start, WITNESS_MAX_MOVES)).toStrictEqual(result);
        const replay =
          result.kind === 'solved' ? verifyLine(PIG_ENGINE, start, result.line).kind : 'no win';
        expect(replay).toBe(result.kind === 'solved' ? 'wins' : 'no win');
      }),
      { seed: 23, numRuns: 80 },
    );
  });
});
