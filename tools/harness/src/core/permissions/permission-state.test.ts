// src/core/permissions/permission-state.test.ts
import fc from 'fast-check';

import { isPermissionAllowed, nextAskStep } from './permission-state';

import type { AskStep, PermissionState } from './permission-state';

const STATES: readonly PermissionState[] = [
  'granted',
  'limited',
  'provisional',
  'undetermined',
  'denied',
  'blocked',
  'unavailable',
];

describe('isPermissionAllowed', () => {
  it.each([
    ['granted', true],
    ['limited', true],
    ['provisional', true],
    ['undetermined', false],
    ['denied', false],
    ['blocked', false],
    ['unavailable', false],
  ] as const)('answers %s with %s', (state, isAllowed) => {
    expect(isPermissionAllowed(state)).toBe(isAllowed);
  });
});

describe('nextAskStep', () => {
  it.each([
    ['granted', false, 'proceed'],
    ['limited', false, 'proceed'],
    ['provisional', true, 'proceed'],
    ['undetermined', false, 'ask'],
    ['undetermined', true, 'explain'],
    ['denied', false, 'rationale'],
    ['denied', true, 'rationale'],
    ['blocked', false, 'settings'],
    ['blocked', true, 'settings'],
    ['unavailable', true, 'unavailable'],
  ] as const)('steps from %s (explain first: %s) to %s', (state, shouldExplainFirst, expected) => {
    expect(nextAskStep(state, { shouldExplainFirst })).toBe<AskStep>(expected);
  });

  it('opens the system dialog only from a state in which the OS can still show it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATES), fc.boolean(), (state, shouldExplainFirst) => {
        const step = nextAskStep(state, { shouldExplainFirst });
        const isDialogNext = step === 'ask' || step === 'explain' || step === 'rationale';
        expect(isDialogNext).toBe(state === 'undetermined' || state === 'denied');
      }),
    );
  });

  it('proceeds exactly when the capability is allowed', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATES), fc.boolean(), (state, shouldExplainFirst) => {
        expect(nextAskStep(state, { shouldExplainFirst }) === 'proceed').toBe(
          isPermissionAllowed(state),
        );
      }),
    );
  });
});
