// src/games/pig/rules/outcome.test.ts
import fc from 'fast-check';

import { ENDLESS_DIFFICULTY } from '@/core/game/difficulty';
import { playChoices } from '@/core/game/testing/play-choices';

import { applyMove } from './apply-move';
import { create } from './create';
import { listMoves } from './list-moves';
import { outcome } from './outcome';
import { TUNING, knobsFor } from './pig-tuning';

// Expectations read the knobs from TUNING and knobsFor, never as literals: a balance pass
// (game-balance-and-bots) changes the numbers without touching these tests.
const ROW_0 = knobsFor(0);

describe('outcome', () => {
  it('reports a win with the banked points plus the spare turns', () => {
    const turn = ROW_0.maxTurns - 4;
    expect(outcome({ ...create(1, 0), banked: ROW_0.target + 2, turn })).toStrictEqual({
      kind: 'won',
      score: ROW_0.target + 2 + 4 * TUNING.pointsPerSpareTurn,
    });
  });

  it('names the bust streak before the turn budget', () => {
    const outOfTurns = { ...create(1, 0), turn: ROW_0.maxTurns };
    expect(outcome({ ...outOfTurns, busts: TUNING.maxBusts })).toStrictEqual({
      kind: 'lost',
      reasonKey: 'pig.lose.bust-streak',
    });
    expect(outcome(outOfTurns)).toStrictEqual({
      kind: 'lost',
      reasonKey: 'pig.lose.out-of-turns',
    });
  });

  it('reports no win in the endless run, whatever is banked', () => {
    expect(outcome({ ...create(1, ENDLESS_DIFFICULTY), banked: 5000 }).kind).toBe('playing');
  });

  it('lists no moves exactly when the run is over', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.integer({ min: 0, max: 100 }),
        fc.array(fc.nat(), { maxLength: 80 }),
        (seed, difficulty, choices) => {
          const { states } = playChoices(
            { listMoves, applyMove },
            create(seed, difficulty),
            choices,
          );
          for (const state of states) {
            expect(listMoves(state).length === 0).toBe(outcome(state).kind !== 'playing');
          }
        },
      ),
    );
  });
});
