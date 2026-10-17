// src/stores/premium/premium-reducer.test.ts
import fc from 'fast-check';

import { premiumReducer } from './premium-reducer';
import { PREMIUM_REDUCER_CASES } from './premium-reducer-cases';

import type { PremiumState } from './premium-reducer';

const { initial, cases } = PREMIUM_REDUCER_CASES;
const CHANGES = cases.flatMap((item) =>
  'expect' in item
    ? [
        {
          rule: item.rule,
          before: item.state ?? initial,
          action: item.action,
          expected: item.expect,
        },
      ]
    : [],
);
const NO_OPS = cases.flatMap((item) =>
  'same' in item ? [{ rule: item.rule, before: item.state ?? initial, action: item.action }] : [],
);

describe('premiumReducer', () => {
  it.each(CHANGES)('applies $rule', ({ before, action, expected }) => {
    expect(premiumReducer(before, action)).toMatchObject(expected);
  });

  it.each(NO_OPS)('returns the same state for $rule', ({ before, action }) => {
    expect(premiumReducer(before, action)).toBe(before);
  });

  it('keeps Premium without a positive revocation date', () => {
    const owned: PremiumState = {
      entitlement: { isOwned: true, ownedSinceMs: 1, revokedAtMs: null },
    };
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (revokedAtMs) => {
        expect(premiumReducer(owned, { type: 'revoke-premium', revokedAtMs })).toBe(owned);
      }),
    );
  });

  it('ignores a second grant', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (first, second) => {
        const once = premiumReducer(initial, { type: 'grant-premium', atMs: first });
        expect(premiumReducer(once, { type: 'grant-premium', atMs: second })).toBe(once);
      }),
    );
  });
});
