// src/core/game/level-kit/star-rating.test.ts
import fc from 'fast-check';

import { PAR_SLACK_FOR_TWO_STARS, isScoreRule, starsFor } from './star-rating';

import type { StarRule } from '@/core/game/levels';

const PAR_7: StarRule = { kind: 'par', par: 7 };
const SCORE: StarRule = { kind: 'score', thresholds: [100, 250, 400] };
const win = (moves: number, score = 0) => ({ isWon: true, moves, score });

describe('starsFor', () => {
  describe('when the level is rated against par', () => {
    it.each([
      [5, 3],
      [7, 3],
      [8, 2],
      [9, 2],
      [10, 1],
      [40, 1],
    ])('gives a win in %i moves %i stars at par 7', (moves, stars) => {
      expect(starsFor(PAR_7, win(moves))).toBe(stars);
    });
  });

  describe('when the level is rated by score', () => {
    it.each([
      [100, 1],
      [249, 1],
      [250, 2],
      [399, 2],
      [400, 3],
    ])('gives a win with score %i %i stars', (score, stars) => {
      expect(starsFor(SCORE, win(12, score))).toBe(stars);
    });
  });

  it('gives a loss 0 stars under either rule', () => {
    expect(starsFor(PAR_7, { isWon: false, moves: 3, score: 0 })).toBe(0);
    expect(starsFor(SCORE, { isWon: false, moves: 3, score: 999 })).toBe(0);
  });

  it('keeps fewer moves at least as many stars as more moves', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.nat(60), fc.nat(60), (par, a, b) => {
        const rule: StarRule = { kind: 'par', par };
        const [few, many] = a <= b ? [a, b] : [b, a];
        expect(starsFor(rule, win(few))).toBeGreaterThanOrEqual(starsFor(rule, win(many)));
      }),
      { seed: 3, numRuns: 300 },
    );
  });

  it('keeps 2 stars exactly up to par + PAR_SLACK_FOR_TWO_STARS', () => {
    expect(starsFor(PAR_7, win(7 + PAR_SLACK_FOR_TWO_STARS))).toBe(2);
    expect(starsFor(PAR_7, win(8 + PAR_SLACK_FOR_TWO_STARS))).toBe(1);
  });
});

describe('isScoreRule', () => {
  it('tells score rules from par rules', () => {
    expect(isScoreRule(SCORE)).toBe(true);
    expect(isScoreRule(PAR_7)).toBe(false);
  });
});
