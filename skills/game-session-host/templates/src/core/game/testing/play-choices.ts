// src/core/game/testing/play-choices.ts
// Drives any pure rules module from a list of "choice" integers: fast-check generates them and
// choice % legalMoves.length picks the move, so properties explore legal move sequences without
// knowing the game.
import type { GameEngine } from '@/core/game/game-engine';

/** The engine subset property tests need; any game's engine satisfies it. */
export type PlayableRules<TState, TMove, TEvent> = Pick<
  GameEngine<TState, TMove, TEvent>,
  'listMoves' | 'applyMove'
>;

export type PlayLog<TState, TEvent> = {
  readonly states: readonly TState[];
  readonly events: readonly TEvent[];
};

/**
 * Plays `choices` from `start`: each choice picks listMoves(state)[choice % count]; stops early when
 * no move is left. Returns every state visited (start first) and every event, in order.
 */
export function playChoices<TState, TMove, TEvent>(
  rules: PlayableRules<TState, TMove, TEvent>,
  start: TState,
  choices: readonly number[],
): PlayLog<TState, TEvent> {
  const states: TState[] = [start];
  const events: TEvent[] = [];
  let state = start;
  for (const choice of choices) {
    const moves = rules.listMoves(state);
    const move = moves[choice % Math.max(moves.length, 1)];
    if (move === undefined) {
      break;
    }
    const result = rules.applyMove(state, move);
    state = result.state;
    states.push(state);
    events.push(...result.events);
  }
  return { states, events };
}
