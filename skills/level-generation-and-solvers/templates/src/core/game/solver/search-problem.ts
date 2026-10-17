// src/core/game/solver/search-problem.ts
import type { GameEngine } from '@/core/game/game-engine';

/**
 * A puzzle seen as a graph: states, legal moves, the goal, dead ends and a canonical key.
 * Solvers only ever see this shape, so one BFS or IDA* serves every game.
 */
export type SearchProblem<TState, TMove> = {
  readonly start: TState;
  readonly moves: (state: TState) => readonly TMove[];
  readonly apply: (state: TState, move: TMove) => TState;
  readonly isGoal: (state: TState) => boolean;
  /** True for states that can never reach the goal (a loss); they are never expanded. */
  readonly isDeadEnd: (state: TState) => boolean;
  /** Two states with the same key must play out identically from here on (move count excluded). */
  readonly key: (state: TState) => string;
};

/** The engine members a solver needs; any GameModule engine satisfies it. */
export type SolvableEngine<TState, TMove, TEvent> = Pick<
  GameEngine<TState, TMove, TEvent>,
  'listMoves' | 'applyMove' | 'outcome'
>;

/** Wraps a game's own pure engine as a search problem: won is the goal, lost is a dead end. */
export function engineProblem<TState, TMove, TEvent>(
  engine: SolvableEngine<TState, TMove, TEvent>,
  key: (state: TState) => string,
  start: TState,
): SearchProblem<TState, TMove> {
  return {
    start,
    moves: engine.listMoves,
    apply: (state, move) => engine.applyMove(state, move).state,
    isGoal: (state) => engine.outcome(state).kind === 'won',
    isDeadEnd: (state) => engine.outcome(state).kind === 'lost',
    key,
  };
}
