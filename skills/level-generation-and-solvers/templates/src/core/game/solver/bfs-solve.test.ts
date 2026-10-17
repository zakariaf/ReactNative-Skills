// src/core/game/solver/bfs-solve.test.ts
import { bfsSolve } from './bfs-solve';

import type { SearchProblem } from './search-problem';

/** Walk from 0 to `target` with steps of +1 or +3; passing the target is a dead end. */
function numberLine(target: number): SearchProblem<number, number> {
  return {
    start: 0,
    moves: () => [1, 3],
    apply: (state, move) => state + move,
    isGoal: (state) => state === target,
    isDeadEnd: (state) => state > target,
    key: (state) => String(state),
  };
}

describe('bfsSolve', () => {
  it('finds the shortest line, so its length is par, and the goal it ends in', () => {
    expect(bfsSolve(numberLine(7), 1000)).toStrictEqual({
      kind: 'solved',
      par: 3,
      line: [1, 3, 3],
      final: 7,
    });
  });

  it('returns par 0 when the start already wins', () => {
    expect(bfsSolve(numberLine(0), 10)).toStrictEqual({
      kind: 'solved',
      par: 0,
      line: [],
      final: 0,
    });
  });

  it('reports unsolvable when every line runs into a dead end', () => {
    const evenOnly = { ...numberLine(7), moves: () => [2] };
    expect(bfsSolve(evenOnly, 1000)).toStrictEqual({ kind: 'unsolvable' });
  });

  it('stops at the node budget instead of searching forever', () => {
    expect(bfsSolve(numberLine(90), 5)).toStrictEqual({ kind: 'budget-exceeded' });
  });

  it('returns the same line on every run (deterministic move order)', () => {
    expect(bfsSolve(numberLine(11), 1000)).toStrictEqual(bfsSolve(numberLine(11), 1000));
  });
});
