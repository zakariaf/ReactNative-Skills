// src/core/game-balance/trace-bot.test.ts
import { playBot, randomPolicy } from '@/core/game/testing/play-bot';

import { traceBot } from './trace-bot';

import type { EventTag } from './trace-bot';
import type { BotGame } from '@/core/game/testing/play-bot';

type Pile = { readonly value: number; readonly target: number };
type PileEvent = { readonly kind: 'added'; readonly amount: number } | { readonly kind: 'exact' };

const PILE: BotGame<Pile, number, PileEvent> = {
  create: (_seed, difficulty) => ({ value: 0, target: 10 + difficulty }),
  listMoves: () => [1, 2, 3],
  applyMove: (state, move) => {
    const value = state.value + move;
    const added: PileEvent = { kind: 'added', amount: move };
    return {
      state: { ...state, value },
      events: value === state.target ? [added, { kind: 'exact' }] : [added],
    };
  },
  outcome: (state) => {
    if (state.value === state.target) return { kind: 'won', score: state.value };
    return state.value > state.target
      ? { kind: 'lost', reasonKey: 'pile.over' }
      : { kind: 'playing' };
  },
};

/** 'exact' is the win moment; adding 3 at once is this toy's "twist". */
function tagPile(event: PileEvent): readonly EventTag[] {
  if (event.kind === 'exact') return ['payoff'];
  return event.amount === 3 ? ['twist'] : [];
}

const trace = (seed: number) =>
  traceBot(PILE, {
    seed,
    difficulty: 1,
    policy: randomPolicy(),
    maxMoves: 40,
    tagEvent: tagPile,
    scoreOf: (state) => state.value,
  });

describe('traceBot', () => {
  it('plays exactly the game playBot plays for the same inputs', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const played = playBot(PILE, { seed, difficulty: 1, policy: randomPolicy(), maxMoves: 40 });
      const traced = trace(seed);
      expect({ outcome: traced.outcome, moves: traced.moves }).toStrictEqual(played);
    }
  });

  it('records when the first payoff happened and how often each tag fired', () => {
    const won = Array.from({ length: 30 }, (_, seed) => trace(seed)).find(
      (run) => run.outcome.kind === 'won',
    );
    expect(won?.firstAt.payoff).toBe(won?.moves);
    expect(won?.counts.payoff).toBe(1);
    expect(won?.score).toBe(11);
    expect(won?.isCapped).toBe(false);
  });

  it('flags a run that hit maxMoves while still playing, where playBot stops too', () => {
    const endless: BotGame<number, number, PileEvent> = {
      create: () => 0,
      listMoves: () => [1],
      applyMove: (state) => ({ state, events: [] }),
      outcome: () => ({ kind: 'playing' }),
    };
    const run = traceBot(endless, {
      seed: 1,
      difficulty: 0,
      policy: randomPolicy(),
      maxMoves: 12,
      tagEvent: () => [],
      scoreOf: () => 0,
    });
    expect([run.moves, run.isCapped, run.counts]).toStrictEqual([
      12,
      true,
      { payoff: 0, twist: 0 },
    ]);
    const played = playBot(endless, {
      seed: 1,
      difficulty: 0,
      policy: randomPolicy(),
      maxMoves: 12,
    });
    expect(played).toStrictEqual({ outcome: { kind: 'playing' }, moves: 12 });
  });
});
