// src/games/pig/testing/pig-testing.test.ts
import { playBot } from '@/core/game/testing/play-bot';
import { PIG_ENGINE } from '@/games/pig/rules/pig-engine';

import { PIG_TESTING } from './pig-testing';

describe('PIG_TESTING', () => {
  it('gives every example state the outcome its name promises', () => {
    const { examples } = PIG_TESTING;
    const states = [examples.start(), examples.middle(), examples.win(), examples.lose()];
    expect(states.map((state) => PIG_ENGINE.outcome(state).kind)).toStrictEqual([
      'playing',
      'playing',
      'won',
      'lost',
    ]);
  });

  it('finishes every bot run, and wins some at the easiest row', () => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
      playBot(PIG_ENGINE, { seed, difficulty: 0, policy: PIG_TESTING.bot, maxMoves: 400 }),
    );
    expect(runs.every((run) => run.outcome.kind !== 'playing')).toBe(true);
    expect(runs.some((run) => run.outcome.kind === 'won')).toBe(true);
  });
});
