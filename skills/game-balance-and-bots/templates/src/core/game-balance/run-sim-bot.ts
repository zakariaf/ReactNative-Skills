// src/core/game-balance/run-sim-bot.ts
// Balance runs for real-time games: the same fixed-step `step` the UI thread runs, driven headless
// by a command policy. The result is a BotTrace, so summarizeCell and the bands work unchanged:
// "moves" are ticks, and firstAt counts payoffStepTicks steps (seconds at 120), so the kill test's
// firstPayoffShare[k - 1] reads "the first payoff within k seconds".
import { seedRng } from '@/core/rng/sfc32';

import { NO_TAGS, addTags } from './trace-bot';

import type { BotTrace, EventTag } from './trace-bot';
import type { Outcome } from '@/core/game/game-engine';
import type { RngState } from '@/core/rng/sfc32';

/** The real-time game members a sim bot needs (step and drainEvents are the sim's own worklets). */
export type SimBotGame<TSim> = {
  readonly create: (seed: number, difficulty: number) => TSim;
  readonly step: (sim: TSim, command: number) => void;
  /** Flat [kind, value, tick, ...] triples since the last drain. */
  readonly drainEvents: (sim: TSim) => readonly number[];
  readonly outcome: (sim: TSim) => Outcome;
  readonly scoreOf: (sim: TSim) => number;
  /** Which tags an event kind carries (payoff: a win moment; twist: the game's special mechanic). */
  readonly tagEvent: (kind: number, value: number) => readonly EventTag[];
};

/** Chooses the next integer command from the sim (never from wall time). */
export type CommandPolicy<TSim> = (
  sim: TSim,
  rng: RngState,
) => { readonly command: number; readonly rng: RngState };

export type SimBotOptions<TSim> = {
  readonly seed: number;
  readonly difficulty: number;
  readonly policy: CommandPolicy<TSim>;
  /** Hard cap: a run that is still playing here counts as capped. */
  readonly maxTicks: number;
  /** A human changes the stick about every 100 ms: 12 ticks at 120 Hz. */
  readonly decideEveryTicks: number;
  /** Ticks per step of the first-payoff curve: 120 at 120 Hz makes firstAt count seconds. */
  readonly payoffStepTicks: number;
};

/** The tags of drained [kind, value, tick] triples, with the 1-based tick each happened on. */
function tagsOf<TSim>(
  game: SimBotGame<TSim>,
  events: readonly number[],
): { tags: EventTag[]; tick: number }[] {
  const out: { tags: EventTag[]; tick: number }[] = [];
  for (let i = 0; i + 2 < events.length; i += 3) {
    out.push({
      tags: [...game.tagEvent(Number(events[i]), Number(events[i + 1]))],
      tick: Number(events[i + 2]) + 1,
    });
  }
  return out;
}

/** Plays one real-time run headless in fixed ticks. Same seed and policy, same trace. */
export function runSimBot<TSim>(game: SimBotGame<TSim>, options: SimBotOptions<TSim>): BotTrace {
  const sim = game.create(options.seed, options.difficulty);
  let rng = seedRng(options.seed ^ 0x5bd1e995);
  let command = 0;
  let seen = NO_TAGS;
  let tick = 0;
  while (tick < options.maxTicks && game.outcome(sim).kind === 'playing') {
    if (tick % options.decideEveryTicks === 0) {
      const choice = options.policy(sim, rng);
      command = choice.command;
      rng = choice.rng;
    }
    game.step(sim, command);
    tick += 1;
    for (const batch of tagsOf(game, game.drainEvents(sim)))
      seen = addTags(seen, batch.tags, Math.floor((batch.tick - 1) / options.payoffStepTicks) + 1);
  }
  const outcome = game.outcome(sim);
  return {
    outcome,
    moves: tick,
    isCapped: outcome.kind === 'playing',
    score: game.scoreOf(sim),
    firstAt: seen.firstAt,
    counts: seen.counts,
  };
}
