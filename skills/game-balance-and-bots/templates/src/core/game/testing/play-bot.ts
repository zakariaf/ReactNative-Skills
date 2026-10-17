// src/core/game/testing/play-bot.ts
// Plays one game headless with a policy. Bots draw from their own seeded stream, never Math.random,
// so a bot game is as reproducible as the rules (game-balance-and-bots builds on this).
import { nextInt, seedRng } from '@/core/rng/sfc32';

import type { GameEngine, Outcome } from '@/core/game/game-engine';
import type { RngState } from '@/core/rng/sfc32';

/** A bot picks one of the legal moves and returns its random state (advanced if it drew). */
export type BotPolicy<TState, TMove> = (
  state: TState,
  moves: readonly TMove[],
  rng: RngState,
) => { readonly move: TMove; readonly rng: RngState };

/** The engine subset a bot needs; any game's engine satisfies it. */
export type BotGame<TState, TMove, TEvent> = Pick<
  GameEngine<TState, TMove, TEvent>,
  'create' | 'listMoves' | 'applyMove' | 'outcome'
>;

/** How one bot game ended and after how many moves. */
export type BotRun = { readonly outcome: Outcome; readonly moves: number };

/** Seed, difficulty, policy and a hard move cap (a stuck bot must end, not hang). */
export type BotOptions<TState, TMove> = {
  readonly seed: number;
  readonly difficulty: number;
  readonly policy: BotPolicy<TState, TMove>;
  readonly maxMoves: number;
};

/** The salt of a bot's own stream, so it never replays the level's draws. */
const BOT_STREAM_SALT = 0x5bd1e995;

/** Uniformly random legal move; the baseline for winnability and difficulty curves. */
export function randomPolicy<TState, TMove>(): BotPolicy<TState, TMove> {
  return (_state, moves, rng) => {
    const draw = nextInt(rng, moves.length);
    const move = moves[draw.value];
    if (move === undefined) throw new Error('randomPolicy called without legal moves');
    return { move, rng: draw.state };
  };
}

/** Plays one game headless. Same seed + same policy = same game, on every machine. */
export function playBot<TState, TMove, TEvent>(
  game: BotGame<TState, TMove, TEvent>,
  options: BotOptions<TState, TMove>,
): BotRun {
  let state = game.create(options.seed, options.difficulty);
  let rng = seedRng(options.seed ^ BOT_STREAM_SALT);
  for (let played = 0; played < options.maxMoves; played += 1) {
    const outcome = game.outcome(state);
    const moves = game.listMoves(state);
    if (outcome.kind !== 'playing' || moves.length === 0) return { outcome, moves: played };
    const choice = options.policy(state, moves, rng);
    rng = choice.rng;
    state = game.applyMove(state, choice.move).state;
  }
  return { outcome: game.outcome(state), moves: options.maxMoves };
}
