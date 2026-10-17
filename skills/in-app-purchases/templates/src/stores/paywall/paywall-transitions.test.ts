// src/stores/paywall/paywall-transitions.test.ts
import { INITIAL_PAYWALL_STATE } from './paywall-state';
import {
  onPurchaseFailure,
  onPurchaseFinished,
  onRestoreFinished,
  onStartPurchase,
} from './paywall-transitions';

import type { PaywallFlow, PaywallState } from './paywall-state';

const at = (flow: PaywallFlow): PaywallState => ({ ...INITIAL_PAYWALL_STATE, flow });
const READY = at({ kind: 'ready', price: '$2.99' });
const BUYING = at({ kind: 'purchasing', price: '$2.99' });

describe('onStartPurchase', () => {
  it('starts from a quiet page with a price', () => {
    expect(onStartPurchase(READY, false).flow).toStrictEqual({
      kind: 'purchasing',
      price: '$2.99',
    });
  });

  it('refuses an owner, a page without a price and a flow in progress', () => {
    expect(onStartPurchase(READY, true)).toBe(READY);
    const noPrice = at({ kind: 'restore-failed', price: null });
    expect(onStartPurchase(noPrice, false)).toBe(noPrice);
    expect(onStartPurchase(BUYING, false)).toBe(BUYING);
  });
});

describe('onPurchaseFailure', () => {
  it('maps each failure while purchasing', () => {
    expect(onPurchaseFailure(BUYING, 'cancelled').flow.kind).toBe('ready');
    expect(onPurchaseFailure(BUYING, 'deferred').flow.kind).toBe('pending');
    expect(onPurchaseFailure(BUYING, 'already-owned').flow.kind).toBe('restoring');
    expect(onPurchaseFailure(BUYING, 'unavailable').flow.kind).toBe('unavailable');
    expect(onPurchaseFailure(BUYING, 'failed').flow.kind).toBe('failed');
  });

  it('ignores a failure outside a purchase (iOS reports one twice)', () => {
    const pending = onPurchaseFailure(BUYING, 'deferred');
    expect(onPurchaseFailure(pending, 'failed')).toBe(pending);
  });
});

describe('onPurchaseFinished', () => {
  it('thanks only a buyer, never a purchase delivered at launch', () => {
    expect(onPurchaseFinished(BUYING).didJustPurchase).toBe(true);
    expect(onPurchaseFinished(at({ kind: 'pending', price: '$2.99' })).didJustPurchase).toBe(true);
    expect(onPurchaseFinished(INITIAL_PAYWALL_STATE)).toBe(INITIAL_PAYWALL_STATE);
  });
});

describe('onRestoreFinished', () => {
  const restoring = at({ kind: 'restoring', price: '$2.99' });

  it('says "couldn\'t restore" after a failed sync', () => {
    expect(onRestoreFinished(restoring, 'sync-failed', true).flow.kind).toBe('restore-failed');
  });

  it('says "nothing to restore" only to someone without Premium', () => {
    expect(onRestoreFinished(restoring, 'unknown', false).flow.kind).toBe('restore-empty');
    expect(onRestoreFinished(restoring, 'unknown', true).flow.kind).toBe('ready');
  });

  it('marks a restored purchase with the notice, never the thank-you', () => {
    const restored = onRestoreFinished(restoring, 'owned', true);
    expect(restored.didJustRestore).toBe(true);
    expect(restored.didJustPurchase).toBe(false);
  });
});
