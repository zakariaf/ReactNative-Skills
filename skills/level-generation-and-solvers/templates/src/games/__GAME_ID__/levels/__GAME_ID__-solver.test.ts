// src/games/__GAME_ID__/levels/__GAME_ID__-solver.test.ts
import fc from 'fast-check';

import { verifyLine } from '@/core/game/solver/verify-line';
import { applyMove } from '@/games/__GAME_ID__/rules/apply-move';
import { create, shapeFor } from '@/games/__GAME_ID__/rules/create';
import { listMoves } from '@/games/__GAME_ID__/rules/list-moves';
import { outcome } from '@/games/__GAME_ID__/rules/outcome';

import { suggestToggle, __GAME_CONST___SOLVER } from './__GAME_ID__-solver';

import type { Cell, __GAME_PASCAL__State } from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

const ENGINE = { listMoves, applyMove, outcome };

function board(lit: readonly number[]): __GAME_PASCAL__State {
  const cells = Array.from({ length: 9 }, (_, index): Cell => (lit.includes(index) ? 1 : 0));
  return { cols: 3, rows: 3, cells, moves: 0, maxMoves: 6 };
}

describe('__GAME_CONST___SOLVER', () => {
  it('finds the single press that darkens a plus shape (par 1)', () => {
    expect(__GAME_CONST___SOLVER.solve(board([1, 3, 4, 5, 7]), 1000)).toStrictEqual({
      kind: 'solved',
      par: 1,
      line: [{ kind: 'toggle', col: 1, row: 1 }],
      final: { ...board([]), moves: 1 },
    });
  });

  it('stops at the node budget', () => {
    expect(__GAME_CONST___SOLVER.solve(create(3, 60), 2)).toStrictEqual({
      kind: 'budget-exceeded',
    });
  });

  it('solves every generated board within its scramble presses, with a line the engine accepts', () => {
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 0, max: 60 }), (seed, difficulty) => {
        const start = create(seed, difficulty);
        const result = __GAME_CONST___SOLVER.solve(start, 60_000);
        if (result.kind !== 'solved') throw new Error(`not solved: ${result.kind}`);
        expect(result.par).toBeLessThanOrEqual(shapeFor(difficulty).presses);
        expect(verifyLine(ENGINE, start, result.line)).toStrictEqual({
          kind: 'wins',
          moves: result.par,
        });
      }),
      { seed: 17, numRuns: 60 },
    );
  });
});

describe('suggestToggle', () => {
  it('suggests the first press of a shortest solution', () => {
    expect(suggestToggle(board([0, 1, 3]))).toStrictEqual({ kind: 'toggle', col: 0, row: 0 });
  });

  it('suggests nothing on a board that is already dark', () => {
    expect(suggestToggle(board([]))).toBeNull();
  });

  it('suggests nothing when no set of presses can darken the board', () => {
    const pair: __GAME_PASCAL__State = { cols: 2, rows: 1, cells: [1, 0], moves: 0, maxMoves: 3 };
    expect(__GAME_CONST___SOLVER.solve(pair, 100)).toStrictEqual({ kind: 'unsolvable' });
    expect(suggestToggle(pair)).toBeNull();
  });
});
