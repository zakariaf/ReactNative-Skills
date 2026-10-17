// src/stores/debug-overrides/debug-overrides-reducer.test.ts
import { DEFAULT_DEBUG_OVERRIDES } from './debug-overrides';
import { debugOverridesReducer } from './debug-overrides-reducer';
import { DEBUG_OVERRIDES_REDUCER_CASES } from './debug-overrides-reducer-cases';

describe('debugOverridesReducer', () => {
  it('starts its cases from the real defaults', () => {
    expect(DEBUG_OVERRIDES_REDUCER_CASES.initial).toStrictEqual(DEFAULT_DEBUG_OVERRIDES);
  });

  it.each(DEBUG_OVERRIDES_REDUCER_CASES.cases.map((entry) => [entry.rule, entry] as const))(
    'keeps the rule %s',
    (_rule, entry) => {
      const state = entry.state ?? DEBUG_OVERRIDES_REDUCER_CASES.initial;
      const next = debugOverridesReducer(state, entry.action);
      const isSame = 'same' in entry;

      // A change that changes nothing returns the same object, so the store writes nothing.
      expect(next === state).toBe(isSame);
      expect(next).toStrictEqual(isSame ? state : { ...state, ...entry.expect });
    },
  );
});
