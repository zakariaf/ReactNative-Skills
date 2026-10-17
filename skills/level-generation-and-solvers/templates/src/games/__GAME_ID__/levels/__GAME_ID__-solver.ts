// src/games/__GAME_ID__/levels/__GAME_ID__-solver.ts
import { bfsSolve } from '@/core/game/solver/bfs-solve';
import { neighbourhood, toggleCells } from '@/games/__GAME_ID__/rules/toggle-cells';

import type { Solver } from '@/core/game/levels';
import type { SearchProblem } from '@/core/game/solver/search-problem';
import type {
  Cell,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__State,
} from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

/** A search node: the board plus the first cell index still allowed to be pressed. */
type Pressing = { readonly cells: readonly Cell[]; readonly next: number };

/**
 * Presses commute and a second press on a cell undoes the first, so a solution is a SET of
 * cells. Searching subsets in index order (each cell at most once) visits every candidate once
 * and, breadth-first, still meets the fewest presses first: the line length is par.
 */
export function pressProblem(start: __GAME_PASCAL__State): SearchProblem<Pressing, __GAME_PASCAL__Move> {
  const { cols, rows } = start;
  const toMove = (index: number): __GAME_PASCAL__Move => ({
    kind: 'toggle',
    col: index % cols,
    row: Math.floor(index / cols),
  });
  return {
    start: { cells: start.cells, next: 0 },
    moves: (node) =>
      Array.from({ length: cols * rows - node.next }, (_, offset) => toMove(node.next + offset)),
    apply: (node, move) => {
      const index = move.row * cols + move.col;
      return { cells: toggleCells(node.cells, neighbourhood(cols, rows, index)), next: index + 1 };
    },
    isGoal: (node) => node.cells.every((cell) => cell === 0),
    isDeadEnd: () => false,
    key: (node) => `${node.cells.join('')}/${String(node.next)}`,
  };
}

/**
 * Exact par for levels, tests and hints: breadth-first over press sets. The search nodes are press
 * sets, not game states, so `final` (the state the line ends in) is the start with the goal's
 * cells and par more moves: exactly what applyMove would give, without its move limit.
 */
export const __GAME_CONST___SOLVER: Solver<__GAME_PASCAL__State, __GAME_PASCAL__Move> = {
  solve: (start, maxNodes) => {
    const result = bfsSolve(pressProblem(start), maxNodes);
    if (result.kind !== 'solved') return result;
    const final = { ...start, cells: result.final.cells, moves: start.moves + result.par };
    return { kind: 'solved', par: result.par, line: result.line, final };
  },
};

/** Node budget for a hint on the device: 4x4 boards solve far below it. */
export const HINT_MAX_NODES = 60_000;

/** rules.hints.suggest: the first press of a shortest solution, or null when none is found. */
export function suggestToggle(state: __GAME_PASCAL__State): __GAME_PASCAL__Move | null {
  const result = __GAME_CONST___SOLVER.solve(state, HINT_MAX_NODES);
  return result.kind === 'solved' ? (result.line[0] ?? null) : null;
}
