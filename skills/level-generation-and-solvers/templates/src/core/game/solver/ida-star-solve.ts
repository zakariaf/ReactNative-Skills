// src/core/game/solver/ida-star-solve.ts
import type { SearchProblem } from './search-problem';
import type { SolveResult } from '@/core/game/levels';

/** A search problem plus an admissible heuristic: never more than the true moves left. */
export type HeuristicProblem<TState, TMove> = SearchProblem<TState, TMove> & {
  readonly heuristic: (state: TState) => number;
};

/** Deterministic limits: expanded nodes over all iterations, and the deepest line tried. */
export type IdaLimits = { readonly maxNodes: number; readonly maxDepth: number };

type Frame<TState> = {
  readonly state: TState;
  readonly depth: number;
  readonly bound: number;
  readonly path: readonly string[];
  readonly budget: number;
};

type Step<TState, TMove> =
  | {
      readonly kind: 'found';
      readonly line: readonly TMove[];
      readonly final: TState;
      readonly used: number;
    }
  | { readonly kind: 'deeper'; readonly nextBound: number; readonly used: number }
  | { readonly kind: 'out-of-budget' };

const OUT_OF_BUDGET = { kind: 'out-of-budget' } as const;

type Search<TState, TMove> = (
  problem: HeuristicProblem<TState, TMove>,
  frame: Frame<TState>,
) => Step<TState, TMove>;

/** Tries every move of one frame in order; keeps the smallest bound that was cut off. */
function searchChildren<TState, TMove>(
  problem: HeuristicProblem<TState, TMove>,
  frame: Frame<TState>,
  search: Search<TState, TMove>,
): Step<TState, TMove> {
  let used = 1;
  let nextBound = Number.POSITIVE_INFINITY;
  for (const move of problem.moves(frame.state)) {
    const state = problem.apply(frame.state, move);
    const key = problem.key(state);
    if (frame.path.includes(key) || problem.isDeadEnd(state)) continue;
    const child = { ...frame, state, depth: frame.depth + 1, budget: frame.budget - used };
    const step = search(problem, { ...child, path: [...frame.path, key] });
    if (step.kind === OUT_OF_BUDGET.kind) return step;
    used += step.used;
    if (step.kind === 'found') return { ...step, line: [move, ...step.line], used };
    nextBound = Math.min(nextBound, step.nextBound);
  }
  return { kind: 'deeper', nextBound, used };
}

/** One depth-first pass below `bound`. */
function searchFrame<TState, TMove>(
  problem: HeuristicProblem<TState, TMove>,
  frame: Frame<TState>,
): Step<TState, TMove> {
  const estimate = frame.depth + problem.heuristic(frame.state);
  if (estimate > frame.bound) return { kind: 'deeper', nextBound: estimate, used: 0 };
  if (problem.isGoal(frame.state)) {
    return { kind: 'found', line: [], final: frame.state, used: 0 };
  }
  if (frame.budget <= 0) return OUT_OF_BUDGET;
  return searchChildren(problem, frame, searchFrame);
}

/**
 * Iterative-deepening A*: optimal (the line length is par) when the heuristic is admissible,
 * and memory stays proportional to the depth. Use it when BFS runs out of memory or budget.
 */
export function idaStarSolve<TState, TMove>(
  problem: HeuristicProblem<TState, TMove>,
  limits: IdaLimits,
): SolveResult<TState, TMove> {
  const startKey = problem.key(problem.start);
  let bound = problem.heuristic(problem.start);
  let budget = limits.maxNodes;
  while (bound <= limits.maxDepth) {
    const frame = { state: problem.start, depth: 0, bound, path: [startKey], budget };
    const step = searchFrame(problem, frame);
    if (step.kind === OUT_OF_BUDGET.kind) return { kind: 'budget-exceeded' };
    if (step.kind === 'found') {
      return { kind: 'solved', par: step.line.length, line: step.line, final: step.final };
    }
    if (step.nextBound === Number.POSITIVE_INFINITY) return { kind: 'unsolvable' };
    budget -= step.used;
    bound = step.nextBound;
  }
  return { kind: 'budget-exceeded' };
}
