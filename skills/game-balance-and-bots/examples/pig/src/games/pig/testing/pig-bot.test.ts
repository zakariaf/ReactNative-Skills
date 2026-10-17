// src/games/pig/testing/pig-bot.test.ts
import { greedyPolicy } from '@/core/game-balance/bot-policies';
import { seedRng } from '@/core/rng/sfc32';
import { create } from '@/games/pig/rules/create';
import { listMoves } from '@/games/pig/rules/list-moves';

import { PIG_SEARCH, evaluatePig, pigBot, scoreOfPig, tagPigEvent } from './pig-bot';

import type { PigState } from '@/games/pig/rules/pig-types';

const START: PigState = create(1, 0);
const RNG = seedRng(5);

describe('evaluatePig', () => {
  it('values banked points above points still at risk', () => {
    const banked = { ...START, banked: 20 };
    const atRisk = { ...START, turnTotal: 20 };
    expect(evaluatePig(banked)).toBeGreaterThan(evaluatePig(atRisk));
    expect(evaluatePig(atRisk)).toBeGreaterThan(evaluatePig(START));
  });
});

describe('scoreOfPig', () => {
  it('reports the banked points the top bar shows', () => {
    expect(scoreOfPig({ ...START, banked: 37, turnTotal: 9 })).toBe(37);
  });
});

describe('tagPigEvent', () => {
  it('tags a surviving roll as the payoff and a bust that loses points as the twist', () => {
    expect(tagPigEvent({ kind: 'die-rolled', face: 4 })).toStrictEqual(['payoff']);
    expect(tagPigEvent({ kind: 'die-rolled', face: 1 })).toStrictEqual([]);
    expect(tagPigEvent({ kind: 'turn-busted', lostPoints: 12, busts: 1 })).toStrictEqual(['twist']);
    expect(tagPigEvent({ kind: 'turn-busted', lostPoints: 0, busts: 2 })).toStrictEqual([]);
    expect(tagPigEvent({ kind: 'turn-banked', points: 20, banked: 20 })).toStrictEqual([]);
  });
});

describe('pigBot', () => {
  it('rolls below 20, holds at 20 and holds as soon as the target is reached', () => {
    const rolling = { ...START, turnTotal: 12 };
    const atTwenty = { ...START, turnTotal: 20 };
    const atTarget = { ...START, banked: 35, turnTotal: 6 };
    expect(pigBot(rolling, listMoves(rolling), RNG).move).toStrictEqual({ kind: 'roll' });
    expect(pigBot(atTwenty, listMoves(atTwenty), RNG).move).toStrictEqual({ kind: 'hold' });
    expect(pigBot(atTarget, listMoves(atTarget), RNG).move).toStrictEqual({ kind: 'hold' });
  });

  it('draws nothing from its own stream, like a person', () => {
    expect(pigBot(START, listMoves(START), RNG).rng).toBe(RNG);
  });
});

describe('why greedyPolicy is not the reasonable player here', () => {
  it('sees the next roll in the state and so never busts with points at risk', () => {
    const peeking = greedyPolicy(PIG_SEARCH, evaluatePig);
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = { ...create(seed, 0), turnTotal: 8 };
      const { move } = peeking(state, listMoves(state), RNG);
      const next = PIG_SEARCH.applyMove(state, move).state;
      expect(next.turnTotal === 0 && next.banked === 0).toBe(false);
    }
  });
});
