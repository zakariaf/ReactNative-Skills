// src/core/game-balance/sim-stats.test.ts
import { FIRST_PAYOFF_MOVES, percentile, round4, summarizeCell } from './sim-stats';

import type { BotTrace } from './trace-bot';

function run(moves: number, isWon: boolean, payoffAt?: number): BotTrace {
  return {
    outcome: isWon ? { kind: 'won', score: moves } : { kind: 'lost', reasonKey: 'demo.lost' },
    moves,
    isCapped: false,
    score: moves * 2,
    firstAt: payoffAt === undefined ? {} : { payoff: payoffAt },
    counts: { payoff: payoffAt === undefined ? 0 : 2, twist: 1 },
  };
}

describe('percentile', () => {
  it('picks the lower middle value and handles empty lists', () => {
    expect(percentile([5, 1, 3, 2], 50)).toBe(2);
    expect(percentile([5, 1, 3, 2], 90)).toBe(3);
    expect(percentile([], 50)).toBe(0);
  });

  it('rounds report numbers to four places', () => {
    expect(round4(2 / 3)).toBe(0.6667);
  });
});

describe('summarizeCell', () => {
  it('summarises wins, move spread, per-run counts and the first-payoff curve', () => {
    const cell = summarizeCell('greedy', 1, [run(10, true, 1), run(20, false, 3), run(30, true)]);
    expect(cell).toStrictEqual({
      policy: 'greedy',
      difficulty: 1,
      runs: 3,
      wins: 2,
      capHits: 0,
      winRate: 0.6667,
      medianMoves: 20,
      p10Moves: 10,
      p90Moves: 20,
      medianScore: 40,
      payoffPerRun: 1.3333,
      twistPerRun: 1,
      lossReasons: { 'demo.lost': 1 },
      firstPayoffShare: [
        0.3333, 0.3333, 0.6667, 0.6667, 0.6667, 0.6667, 0.6667, 0.6667, 0.6667, 0.6667,
      ],
    });
    expect(cell.firstPayoffShare).toHaveLength(FIRST_PAYOFF_MOVES);
  });

  it('refuses an empty cell', () => {
    expect(() => summarizeCell('random', 0, [])).toThrow(RangeError);
  });
});
