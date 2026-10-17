// src/core/game/solver/verify-line.ts
import type { SolvableEngine } from './search-problem';

/** What replaying a claimed winning line with the real engine showed. */
export type LineCheck =
  | { readonly kind: 'wins'; readonly moves: number }
  | { readonly kind: 'illegal-move'; readonly at: number }
  | { readonly kind: 'ended-early'; readonly at: number }
  | { readonly kind: 'does-not-win'; readonly moves: number };

function isListed<TMove>(moves: readonly TMove[], move: TMove): boolean {
  const wanted = JSON.stringify(move);
  return moves.some((candidate) => JSON.stringify(candidate) === wanted);
}

/**
 * Replays `line` from `start` with applyMove and checks that every move was legal and the
 * last one wins. A solver's answer is never trusted on its own: par comes from a checked line.
 */
export function verifyLine<TState, TMove, TEvent>(
  engine: SolvableEngine<TState, TMove, TEvent>,
  start: TState,
  line: readonly TMove[],
): LineCheck {
  let state = start;
  for (let at = 0; at < line.length; at += 1) {
    const move = line[at];
    if (engine.outcome(state).kind !== 'playing') return { kind: 'ended-early', at };
    if (move === undefined || !isListed(engine.listMoves(state), move)) {
      return { kind: 'illegal-move', at };
    }
    state = engine.applyMove(state, move).state;
  }
  return engine.outcome(state).kind === 'won'
    ? { kind: 'wins', moves: line.length }
    : { kind: 'does-not-win', moves: line.length };
}
