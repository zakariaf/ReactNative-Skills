// src/core/game-balance/trace-bot.ts
import { seedRng } from '@/core/rng/sfc32';

import type { Outcome } from '@/core/game/game-engine';
import type { BotGame, BotOptions } from '@/core/game/testing/play-bot';

/** What a balance run watches for: the first "win moment" and the game's twist actually happening. */
export type EventTag = 'payoff' | 'twist';

/** One bot game with what the balance report needs; `moves` equals playBot's for the same inputs. */
export type BotTrace = {
  readonly outcome: Outcome;
  readonly moves: number;
  /** True when the run hit maxMoves still playing (a stuck or endless game). */
  readonly isCapped: boolean;
  /** The game's own score of the final state (points, pairs found, stars...). */
  readonly score: number;
  /** 1-based move at which each tag first happened; absent when it never did. */
  readonly firstAt: Readonly<Partial<Record<EventTag, number>>>;
  readonly counts: Readonly<Record<EventTag, number>>;
};

export type TraceOptions<TState, TMove, TEvent> = BotOptions<TState, TMove> & {
  /** Which tags an event carries (most events carry none). */
  readonly tagEvent: (event: TEvent) => readonly EventTag[];
  /** The number the report calls "score" for this game. */
  readonly scoreOf: (state: TState) => number;
};

type Tally = {
  readonly firstAt: Readonly<Partial<Record<EventTag, number>>>;
  readonly counts: Readonly<Record<EventTag, number>>;
};

export const NO_TAGS: Tally = { firstAt: {}, counts: { payoff: 0, twist: 0 } };

/** Adds the tags of one move to the tally (pure: returns a new tally). */
export function addTags(seen: Tally, tags: readonly EventTag[], move: number): Tally {
  return tags.reduce<Tally>(
    (acc, tag) => ({
      firstAt: { ...acc.firstAt, [tag]: acc.firstAt[tag] ?? move },
      counts: { ...acc.counts, [tag]: acc.counts[tag] + 1 },
    }),
    seen,
  );
}

/**
 * Plays one game headless exactly like playBot (same seed, same bot RNG, same cap) and records
 * the events the balance report needs. Same inputs, same trace, on every machine.
 */
export function traceBot<TState, TMove, TEvent>(
  game: BotGame<TState, TMove, TEvent>,
  options: TraceOptions<TState, TMove, TEvent>,
): BotTrace {
  let state = game.create(options.seed, options.difficulty);
  let rng = seedRng(options.seed ^ 0x5bd1e995);
  let seen = NO_TAGS;
  const finish = (moves: number, isCapped: boolean): BotTrace => ({
    outcome: game.outcome(state),
    moves,
    isCapped,
    score: options.scoreOf(state),
    firstAt: seen.firstAt,
    counts: seen.counts,
  });
  for (let played = 0; played < options.maxMoves; played += 1) {
    const moves = game.listMoves(state);
    if (game.outcome(state).kind !== 'playing' || moves.length === 0) return finish(played, false);
    const choice = options.policy(state, moves, rng);
    rng = choice.rng;
    const result = game.applyMove(state, choice.move);
    state = result.state;
    seen = addTags(seen, result.events.flatMap(options.tagEvent), played + 1);
  }
  return finish(options.maxMoves, game.outcome(state).kind === 'playing');
}
