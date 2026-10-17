// src/stores/paywall/paywall-reducer.test.ts
import { paywallNotice } from './paywall-notice';
import { paywallReducer } from './paywall-reducer';
import { PAYWALL_REDUCER_CASES } from './paywall-reducer-cases';
import { INITIAL_PAYWALL_STATE } from './paywall-state';
import { paywallView } from './paywall-view';

import type { PaywallAction, PaywallState } from './paywall-state';
import type { PaywallView } from './paywall-view';

const { initial, cases } = PAYWALL_REDUCER_CASES;
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
const run = (actions: readonly PaywallAction[]): PaywallState =>
  actions.reduce(paywallReducer, INITIAL_PAYWALL_STATE);
const READY: readonly PaywallAction[] = [{ type: 'set-price', price: '$2.99' }];
const BUYING: readonly PaywallAction[] = [...READY, { type: 'start-purchase', isPremium: false }];

describe('paywallReducer', () => {
  it('starts the cases table from the initial state', () => {
    expect(initial).toStrictEqual(INITIAL_PAYWALL_STATE);
  });

  it.each(CHANGES)('applies $rule', ({ before, action, expected }) => {
    expect(paywallReducer(before, action)).toMatchObject(expected);
  });

  it.each(NO_OPS)('returns the same state for $rule', ({ before, action }) => {
    expect(paywallReducer(before, action)).toBe(before);
  });
});

describe('paywallView', () => {
  const owned = (label: string, actions: readonly PaywallAction[], view: PaywallView) => ({
    label,
    actions,
    isPremium: true,
    view,
  });
  const free = (label: string, actions: readonly PaywallAction[], view: PaywallView) => ({
    label,
    actions,
    isPremium: false,
    view,
  });
  it.each([
    free('loading the price', [], 'loading-price'),
    free('the store is unavailable', [{ type: 'mark-store-unavailable' }], 'store-unavailable'),
    free('the normal page', READY, 'ready'),
    free('a purchase in flight', BUYING, 'purchase-in-progress'),
    free('waiting for approval', [...BUYING, { type: 'mark-purchase-pending' }], 'pending'),
    owned('the thank-you', [...BUYING, { type: 'finish-purchase' }], 'success'),
    owned(
      'owned after the thank-you',
      [...BUYING, { type: 'finish-purchase' }, { type: 'clear-thanks' }],
      'already-owned',
    ),
    owned('a launch delivery', [{ type: 'finish-purchase' }], 'already-owned'),
    free('an error', [...BUYING, { type: 'record-purchase-failure', failure: 'failed' }], 'error'),
    free('an unsaved purchase', [...BUYING, { type: 'record-save-failure' }], 'save-failed'),
  ])('shows $label', ({ actions, isPremium, view }) => {
    expect(paywallView(run(actions), isPremium)).toBe(view);
  });
});

describe('paywallNotice', () => {
  const restoreWith = (evidence: 'owned' | 'unknown' | 'sync-failed'): PaywallState =>
    run([
      ...READY,
      { type: 'start-restore' },
      { type: 'finish-restore', evidence, isPremium: evidence === 'owned' },
    ]);

  it('shows nothing on the normal page', () => {
    expect(paywallNotice(run(READY))).toBeNull();
  });

  it('shows the restoring notice while restoring', () => {
    expect(paywallNotice(run([...READY, { type: 'start-restore' }]))).toBe('restoring');
  });

  it.each([
    ['owned', 'restore-success'],
    ['unknown', 'restore-empty'],
    ['sync-failed', 'restore-failed'],
  ] as const)('maps a restore with %s to %s', (evidence, notice) => {
    expect(paywallNotice(restoreWith(evidence))).toBe(notice);
  });

  it('shows the restored notice once', () => {
    const cleared = paywallReducer(restoreWith('owned'), { type: 'clear-restore-notice' });
    expect(paywallNotice(cleared)).toBeNull();
  });
});
