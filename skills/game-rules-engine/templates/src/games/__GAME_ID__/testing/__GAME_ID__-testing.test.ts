// src/games/__GAME_ID__/testing/__GAME_ID__-testing.test.ts
import { playBot } from '@/core/game/testing/play-bot';
import { seedRng } from '@/core/rng/sfc32';
import { __GAME_CONST___ENGINE } from '@/games/__GAME_ID__/rules/__GAME_ID__-engine';

import { __GAME_CONST___TESTING } from './__GAME_ID__-testing';

const { create, listMoves, outcome } = __GAME_CONST___ENGINE;

describe('__GAME_CONST___TESTING', () => {
  it('gives every example state the outcome its name promises', () => {
    const { examples } = __GAME_CONST___TESTING;
    expect(outcome(examples.start()).kind).toBe('playing');
    expect(outcome(examples.middle()).kind).toBe('playing');
    expect(outcome(examples.win()).kind).toBe('won');
    expect(outcome(examples.lose()).kind).toBe('lost');
  });

  it('lets the bot pick a legal move and pass its random state through', () => {
    const state = create(4, 20);
    const rng = seedRng(4);
    const choice = __GAME_CONST___TESTING.bot(state, listMoves(state), rng);
    expect(listMoves(state)).toContainEqual(choice.move);
    expect(choice.rng).toBe(rng);
  });

  it('finishes every bot game within the move limit', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const run = playBot(__GAME_CONST___ENGINE, {
        seed,
        difficulty: 40,
        policy: __GAME_CONST___TESTING.bot,
        maxMoves: 200,
      });
      expect(run.outcome.kind).not.toBe('playing');
    }
  });
});
