// src/core/game/testing/play-bot.test.ts
import { playBot, randomPolicy } from './play-bot';

import type { BotGame } from './play-bot';

/** Toy game: count up by 1 or 2; exactly 6 wins, passing 6 loses. */
const GAME: BotGame<number, number, never> = {
  create: () => 0,
  listMoves: (state) => (state < 6 ? [1, 2] : []),
  applyMove: (state, step) => ({ state: state + step, events: [] }),
  outcome: (state) => {
    if (state === 6) return { kind: 'won', score: 1 };
    return state > 6 ? { kind: 'lost', reasonKey: 'count.lose.over' } : { kind: 'playing' };
  },
};

describe('playBot', () => {
  it('plays the same game for the same seed', () => {
    const options = {
      seed: 11,
      difficulty: 0,
      policy: randomPolicy<number, number>(),
      maxMoves: 50,
    };
    expect(playBot(GAME, options)).toStrictEqual(playBot(GAME, options));
  });

  it('ends every game within the move cap', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const run = playBot(GAME, { seed, difficulty: 0, policy: randomPolicy(), maxMoves: 50 });
      expect(run.outcome.kind).not.toBe('playing');
    }
  });

  it('stops at maxMoves when the game never ends', () => {
    const stuck: BotGame<number, number, never> = {
      ...GAME,
      outcome: () => ({ kind: 'playing' }),
      listMoves: () => [0],
    };
    expect(
      playBot(stuck, { seed: 1, difficulty: 0, policy: randomPolicy(), maxMoves: 7 }),
    ).toStrictEqual({
      outcome: { kind: 'playing' },
      moves: 7,
    });
  });

  it('refuses to pick from an empty move list', () => {
    expect(() => randomPolicy<number, number>()(0, [], [1, 2, 3, 4])).toThrow(
      'randomPolicy called without legal moves',
    );
  });
});
