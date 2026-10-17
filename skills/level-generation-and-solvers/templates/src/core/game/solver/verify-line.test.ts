// src/core/game/solver/verify-line.test.ts
import { createBfsSolver, createIdaStarSolver } from './engine-solver';
import { verifyLine } from './verify-line';

/** Toy engine: walk from 0 to exactly 5 in steps of 1 or 2; overshooting loses. */
type Walk = { readonly at: number };
const TARGET = 5;
const ENGINE = {
  listMoves: (state: Walk): readonly number[] => (state.at < TARGET ? [1, 2] : []),
  applyMove: (state: Walk, step: number) => ({ state: { at: state.at + step }, events: [] }),
  outcome: (state: Walk) => {
    if (state.at === TARGET) return { kind: 'won', score: 1 } as const;
    return state.at > TARGET
      ? ({ kind: 'lost', reasonKey: 'demo.lose.overshot' } as const)
      : ({ kind: 'playing' } as const);
  },
};
const START: Walk = { at: 0 };
const key = (state: Walk): string => String(state.at);

describe('verifyLine', () => {
  it('accepts a line that is legal and wins', () => {
    expect(verifyLine(ENGINE, START, [2, 2, 1])).toStrictEqual({ kind: 'wins', moves: 3 });
  });

  it('reports the first move that is not in listMoves', () => {
    expect(verifyLine(ENGINE, START, [2, 3])).toStrictEqual({ kind: 'illegal-move', at: 1 });
  });

  it('reports a line that keeps going after the game ended', () => {
    expect(verifyLine(ENGINE, START, [2, 2, 1, 1])).toStrictEqual({ kind: 'ended-early', at: 3 });
  });

  it('reports a legal line that does not reach a win', () => {
    expect(verifyLine(ENGINE, START, [1, 1])).toStrictEqual({ kind: 'does-not-win', moves: 2 });
  });
});

describe('createBfsSolver', () => {
  it('solves through the engine and its line replays as a win', () => {
    const result = createBfsSolver({ engine: ENGINE, key }).solve(START, 100);
    expect(result).toStrictEqual({ kind: 'solved', par: 3, line: [1, 2, 2], final: { at: 5 } });
    expect(result.kind === 'solved' && verifyLine(ENGINE, START, result.line).kind).toBe('wins');
  });
});

describe('createIdaStarSolver', () => {
  it('finds the same par with an admissible heuristic', () => {
    const solver = createIdaStarSolver({
      engine: ENGINE,
      key,
      heuristic: (state) => Math.floor((TARGET - state.at + 1) / 2),
      maxDepth: 10,
    });
    const result = solver.solve(START, 1000);
    expect(result.kind === 'solved' ? result.par : result.kind).toBe(3);
    expect(result.kind === 'solved' ? result.final : null).toStrictEqual({ at: TARGET });
  });
});
