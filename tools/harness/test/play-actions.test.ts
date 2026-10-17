// test/play-actions.test.ts
import fc from 'fast-check';

import { playActions } from './play-actions';

import type { ActionModel } from './play-actions';

type Counter = { readonly value: number; readonly max: number };
type Step = 'up' | 'down' | 'reset';

const NEXT_VALUE: Readonly<Record<Step, (value: number) => number>> = {
  up: (value) => value + 1,
  down: (value) => value - 1,
  reset: () => 0,
};

/** A bounded counter: up below max, down and reset above zero. */
const COUNTER: ActionModel<Counter, Step> = {
  listActions: (state) => [
    ...(state.value < state.max ? (['up'] as const) : []),
    ...(state.value > 0 ? (['down', 'reset'] as const) : []),
  ],
  apply: (state, step) => ({ ...state, value: NEXT_VALUE[step](state.value) }),
};

/** True when every state's value lies within 0..max. */
function staysInRange(states: readonly Counter[], max: number): boolean {
  return states.every((state) => state.value >= 0 && state.value <= max);
}

const maxArb = fc.integer({ min: 0, max: 5 });
const choicesArb = fc.array(fc.nat(), { maxLength: 40 });

describe('playActions', () => {
  it('applies the action each choice picks among the legal ones', () => {
    const log = playActions(COUNTER, { value: 0, max: 2 }, [0, 0, 1]);

    expect(log.actions).toStrictEqual(['up', 'up', 'reset']);
    expect(log.states.map((state) => state.value)).toStrictEqual([0, 1, 2, 0]);
  });

  it('stops at the first state without a legal action', () => {
    const start = { value: 0, max: 0 };

    expect(playActions(COUNTER, start, [3, 1, 4])).toStrictEqual({ states: [start], actions: [] });
  });

  describe('properties', () => {
    it('replays identically for the same start and choices', () => {
      fc.assert(
        fc.property(maxArb, choicesArb, (max, choices) => {
          const first = playActions(COUNTER, { value: 0, max }, choices);
          expect(playActions(COUNTER, { value: 0, max }, choices)).toStrictEqual(first);
        }),
      );
    });

    it('records one state per action and never leaves the legal range', () => {
      fc.assert(
        fc.property(maxArb, choicesArb, (max, choices) => {
          const { states, actions } = playActions(COUNTER, { value: 0, max }, choices);
          expect(states).toHaveLength(actions.length + 1);
          expect(staysInRange(states, max)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });
});
