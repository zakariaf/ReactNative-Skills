// src/core/game/solver/engine-solver.ts
import { bfsSolve } from './bfs-solve';
import { idaStarSolve } from './ida-star-solve';
import { engineProblem } from './search-problem';

import type { SolvableEngine } from './search-problem';
import type { Solver } from '@/core/game/levels';

/** How a game describes its states to a solver: a canonical key and, for IDA*, a lower bound. */
export type SolverSetup<TState, TMove, TEvent> = {
  readonly engine: SolvableEngine<TState, TMove, TEvent>;
  readonly key: (state: TState) => string;
};

/** `levels.solver` for small state spaces: exact par by breadth-first search. */
export function createBfsSolver<TState, TMove, TEvent>(
  setup: SolverSetup<TState, TMove, TEvent>,
): Solver<TState, TMove> {
  return {
    solve: (start, maxNodes) => bfsSolve(engineProblem(setup.engine, setup.key, start), maxNodes),
  };
}

/** `levels.solver` for deep puzzles: exact par by IDA* with an admissible heuristic. */
export function createIdaStarSolver<TState, TMove, TEvent>(
  setup: SolverSetup<TState, TMove, TEvent> & {
    readonly heuristic: (state: TState) => number;
    readonly maxDepth: number;
  },
): Solver<TState, TMove> {
  return {
    solve: (start, maxNodes) => {
      const problem = engineProblem(setup.engine, setup.key, start);
      return idaStarSolve(
        { ...problem, heuristic: setup.heuristic },
        { maxNodes, maxDepth: setup.maxDepth },
      );
    },
  };
}
