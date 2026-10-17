// src/core/game/solver/bfs-solve.ts
import type { SearchProblem } from './search-problem';
import type { SolveResult } from '@/core/game/levels';

type SearchNode<TState, TMove> = {
  readonly state: TState;
  readonly parent: number;
  readonly move: TMove | null;
};

type Frontier<TState, TMove> = {
  readonly nodes: SearchNode<TState, TMove>[];
  readonly seen: Set<string>;
};

function lineTo<TState, TMove>(
  nodes: readonly SearchNode<TState, TMove>[],
  index: number,
): TMove[] {
  const line: TMove[] = [];
  let current = nodes[index];
  while (current !== undefined && current.move !== null) {
    line.push(current.move);
    current = nodes[current.parent];
  }
  return line.reverse();
}

/** Adds the unseen, live children of node `head`; returns the index of a goal child or -1. */
function expand<TState, TMove>(
  problem: SearchProblem<TState, TMove>,
  frontier: Frontier<TState, TMove>,
  head: number,
): number {
  const node = frontier.nodes[head];
  if (node === undefined) return -1;
  for (const move of problem.moves(node.state)) {
    const next = problem.apply(node.state, move);
    const key = problem.key(next);
    if (frontier.seen.has(key)) continue;
    frontier.seen.add(key);
    if (problem.isDeadEnd(next)) continue;
    frontier.nodes.push({ state: next, parent: head, move });
    if (problem.isGoal(next)) return frontier.nodes.length - 1;
  }
  return -1;
}

/**
 * Breadth-first search. Nodes are expanded in order of depth, so the first goal found has the
 * fewest moves: its line length is par, and `final` is the goal node the line reaches.
 * `maxNodes` caps expanded nodes (deterministic budget).
 */
export function bfsSolve<TState, TMove>(
  problem: SearchProblem<TState, TMove>,
  maxNodes: number,
): SolveResult<TState, TMove> {
  if (problem.isGoal(problem.start)) {
    return { kind: 'solved', par: 0, line: [], final: problem.start };
  }
  const frontier: Frontier<TState, TMove> = {
    nodes: [{ state: problem.start, parent: -1, move: null }],
    seen: new Set([problem.key(problem.start)]),
  };
  for (let head = 0; head < frontier.nodes.length; head += 1) {
    if (head >= maxNodes) return { kind: 'budget-exceeded' };
    const goal = expand(problem, frontier, head);
    const found = frontier.nodes[goal];
    if (found !== undefined) {
      const line = lineTo(frontier.nodes, goal);
      return { kind: 'solved', par: line.length, line, final: found.state };
    }
  }
  return { kind: 'unsolvable' };
}
