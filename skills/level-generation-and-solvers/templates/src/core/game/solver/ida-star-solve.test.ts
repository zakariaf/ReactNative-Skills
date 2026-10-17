// src/core/game/solver/ida-star-solve.test.ts
import fc from 'fast-check';

import { nextInt, seedRng } from '@/core/rng/sfc32';

import { bfsSolve } from './bfs-solve';
import { idaStarSolve } from './ida-star-solve';

import type { HeuristicProblem } from './ida-star-solve';
import type { SolveResult } from '@/core/game/levels';

type Cell = { readonly col: number; readonly row: number };

const SIZE = 6;
const STEPS: readonly Cell[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
];

function wallsFor(seed: number, count: number): ReadonlySet<number> {
  let rng = seedRng(seed);
  const walls = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const draw = nextInt(rng, SIZE * SIZE);
    rng = draw.state;
    if (draw.value !== 0 && draw.value !== SIZE * SIZE - 1) walls.add(draw.value);
  }
  return walls;
}

/** A seeded 6x6 maze; the goal is the far corner and Manhattan distance is admissible. */
function maze(seed: number, wallCount = 12): HeuristicProblem<Cell, Cell> {
  const walls = wallsFor(seed, wallCount);
  const isOpen = (cell: Cell): boolean =>
    cell.col >= 0 &&
    cell.row >= 0 &&
    cell.col < SIZE &&
    cell.row < SIZE &&
    !walls.has(cell.row * SIZE + cell.col);
  const step = (state: Cell, by: Cell): Cell => ({
    col: state.col + by.col,
    row: state.row + by.row,
  });
  return {
    start: { col: 0, row: 0 },
    moves: (state) => STEPS.filter((by) => isOpen(step(state, by))),
    apply: step,
    isGoal: (state) => state.col === SIZE - 1 && state.row === SIZE - 1,
    isDeadEnd: () => false,
    key: (state) => `${String(state.col)},${String(state.row)}`,
    heuristic: (state) => SIZE - 1 - state.col + (SIZE - 1 - state.row),
  };
}

/** Par when solved, otherwise the result kind: the part two exact solvers must agree on. */
function verdict(result: SolveResult<Cell, Cell>): number | string {
  return result.kind === 'solved' ? result.par : result.kind;
}

describe('idaStarSolve', () => {
  it('agrees with the BFS par on seeded mazes (both are exact)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (seed) => {
        const problem = maze(seed);
        const ida = idaStarSolve(problem, { maxNodes: 200_000, maxDepth: 40 });
        expect(verdict(ida)).toStrictEqual(verdict(bfsSolve(problem, 10_000)));
      }),
      { seed: 5, numRuns: 150 },
    );
  });

  it('gives up at the depth cap with budget-exceeded, not a false unsolvable', () => {
    const far = { ...maze(1), heuristic: () => 0, isGoal: () => false };
    expect(idaStarSolve(far, { maxNodes: 1_000_000, maxDepth: 4 })).toStrictEqual({
      kind: 'budget-exceeded',
    });
  });

  it('solves an open field at par 10, the Manhattan distance, ending in the far corner', () => {
    const result = idaStarSolve(maze(2, 0), { maxNodes: 10_000, maxDepth: 40 });
    expect(verdict(result)).toBe(10);
    expect(result.kind === 'solved' ? result.final : null).toStrictEqual({
      col: SIZE - 1,
      row: SIZE - 1,
    });
  });

  it('stops at the node budget', () => {
    expect(idaStarSolve(maze(2, 0), { maxNodes: 3, maxDepth: 40 })).toStrictEqual({
      kind: 'budget-exceeded',
    });
  });
});
