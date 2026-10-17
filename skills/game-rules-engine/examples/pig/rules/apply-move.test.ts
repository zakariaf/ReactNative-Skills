// src/games/pig/rules/apply-move.test.ts
import fc from 'fast-check';

import { playChoices } from '@/core/game/testing/play-choices';

import { applyMove } from './apply-move';
import { create } from './create';
import { listMoves } from './list-moves';

import type { PigMove, PigState } from './pig-types';

const RULES = { listMoves, applyMove };
const ROLL: PigMove = { kind: 'roll' };
const HOLD: PigMove = { kind: 'hold' };
const seedArb = fc.integer({ min: 0, max: 4_294_967_295 });
const difficultyArb = fc.integer({ min: 0, max: 100 });
const choicesArb = fc.array(fc.nat(), { maxLength: 60 });

function expectInvariants(states: readonly PigState[]): void {
  states.forEach((state, index) => {
    expect(state.banked).toBeGreaterThanOrEqual(states[index - 1]?.banked ?? 0);
    expect(state.turn).toBeLessThanOrEqual(state.maxTurns);
    expect(state.busts).toBeLessThanOrEqual(state.maxBusts);
  });
}

function play(state: PigState, moves: readonly PigMove[]): PigState {
  return moves.reduce((current, move) => applyMove(current, move).state, state);
}

describe('applyMove', () => {
  it('adds a rolled face to the turn and threads the stream', () => {
    const start = create(1, 0);
    const { state, events } = applyMove(start, ROLL);
    expect(events).toStrictEqual([{ kind: 'die-rolled', face: 6 }]);
    expect(state.turnTotal).toBe(6);
    expect(state.rng).not.toStrictEqual(start.rng);
  });

  it('loses the turn points on a 1 and counts the bust', () => {
    const rolled = play(create(1, 0), [ROLL, ROLL, ROLL]);
    const { state, events } = applyMove(rolled, ROLL);
    expect(events).toStrictEqual([
      { kind: 'die-rolled', face: 1 },
      { kind: 'turn-busted', lostPoints: 13, busts: 1 },
    ]);
    expect(state).toMatchObject({ turnTotal: 0, turn: 1, busts: 1, banked: 0 });
  });

  it('banks the turn on a hold and clears the bust streak', () => {
    const { state, events } = applyMove(play(create(1, 0), [ROLL, ROLL]), HOLD);
    expect(events).toStrictEqual([{ kind: 'turn-banked', points: 10, banked: 10 }]);
    expect(state).toMatchObject({ banked: 10, turnTotal: 0, turn: 1, busts: 0 });
  });

  it('emits target-reached after the hold that reaches the target', () => {
    const close = { ...play(create(1, 0), [ROLL]), banked: 35 };
    expect(applyMove(close, HOLD).events).toStrictEqual([
      { kind: 'turn-banked', points: 6, banked: 41 },
      { kind: 'target-reached', banked: 41 },
    ]);
  });

  describe('when the move is illegal', () => {
    it('throws for a hold with nothing to bank', () => {
      expect(() => applyMove(create(1, 0), HOLD)).toThrow(RangeError);
    });

    it('throws once the run is over', () => {
      const spent = { ...create(1, 0), turn: 10 };
      expect(() => applyMove(spent, ROLL)).toThrow(RangeError);
    });
  });

  describe('properties', () => {
    it('replays identically for the same seed, difficulty and move choices', () => {
      fc.assert(
        fc.property(seedArb, difficultyArb, choicesArb, (seed, difficulty, choices) => {
          const first = playChoices(RULES, create(seed, difficulty), choices);
          expect(playChoices(RULES, create(seed, difficulty), choices)).toStrictEqual(first);
        }),
      );
    });

    it('keeps the banked points rising and every budget within its limit', () => {
      fc.assert(
        fc.property(seedArb, difficultyArb, choicesArb, (seed, difficulty, choices) => {
          expectInvariants(playChoices(RULES, create(seed, difficulty), choices).states);
        }),
      );
    });

    it('survives a JSON round trip unchanged, the stream included', () => {
      fc.assert(
        fc.property(seedArb, choicesArb, (seed, choices) => {
          const { states } = playChoices(RULES, create(seed, 50), choices);
          const last = states[states.length - 1];
          expect(JSON.parse(JSON.stringify(last)) as unknown).toStrictEqual(last);
        }),
      );
    });
  });
});
