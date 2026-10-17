// src/services/purchase/premium-service.test.ts
import { flushMicrotasks } from '@test/flush-microtasks';
import { BOUGHT, createPremiumTestDeps } from '@test/purchase/create-premium-test-deps';

import { restorePremium } from './premium-service';
import { buyPremium, startPremium } from './premium-store-flow';

import type { StoreTransaction } from './purchase-port';

const UNFINISHED: StoreTransaction = { ...BOUGHT, isUnfinished: true };
const REFUNDED: StoreTransaction = { ...BOUGHT, revocationDateMs: 1_700_000_000_000 };

describe('premium service', () => {
  it('saves Premium before it finishes the transaction', async () => {
    const t = createPremiumTestDeps();
    const onDiskAtFinish: boolean[] = [];
    const deps = {
      ...t.deps,
      port: {
        ...t.port,
        finish: async (tx: StoreTransaction) => {
          onDiskAtFinish.push(t.entitlements.saves.at(-1)?.isOwned ?? false);
          return t.port.finish(tx);
        },
      },
    };
    await startPremium(deps);
    await buyPremium(deps);
    t.port.emit({ type: 'transaction', transaction: BOUGHT });
    await flushMicrotasks();
    expect(onDiskAtFinish).toStrictEqual([true]);
    expect(t.premium.getState().entitlement.isOwned).toBe(true);
    expect(t.paywall.getState().didJustPurchase).toBe(true);
  });

  it('leaves a purchase the disk refused unfinished, so the store delivers it again', async () => {
    const t = createPremiumTestDeps();
    await startPremium(t.deps);
    await buyPremium(t.deps);
    t.entitlements.failNextSave = { kind: 'storage-full' };
    t.port.emit({ type: 'transaction', transaction: BOUGHT });
    await flushMicrotasks();
    expect(t.script.calls).not.toContain('finish:t1');
    expect(t.paywall.getState().flow.kind).toBe('unsaved');
    expect(t.premium.getState().entitlement.isOwned).toBe(false);
  });

  it('maps an empty product list to "store unavailable"', async () => {
    const t = createPremiumTestDeps({ product: null });
    await startPremium(t.deps);
    expect(t.paywall.getState().flow).toStrictEqual({ kind: 'unavailable' });
  });

  it('maps a product without price text to "store unavailable"', async () => {
    const t = createPremiumTestDeps({
      product: { productId: BOUGHT.productId, displayPrice: '', price: 2.99, currency: 'USD' },
    });
    await startPremium(t.deps);
    expect(t.paywall.getState().flow).toStrictEqual({ kind: 'unavailable' });
  });

  it('spares an owner the "nothing to restore" notice', async () => {
    const t = createPremiumTestDeps();
    t.premium.getState().grantPremium({ ownedSinceMs: 1 });
    await startPremium(t.deps);
    await restorePremium(t.deps);
    expect(t.paywall.getState().flow.kind).toBe('ready');
    expect(t.premium.getState().entitlement.isOwned).toBe(true);
  });

  it('reports a failed sync as "couldn\'t restore", never "nothing to restore"', async () => {
    const t = createPremiumTestDeps({ restoreResult: 'sync-failed' });
    await restorePremium(t.deps);
    expect(t.paywall.getState().flow.kind).toBe('restore-failed');
    expect(t.script.calls).not.toContain('readTransactions');
  });

  it('keeps Premium when the launch re-check sees no transactions', async () => {
    const t = createPremiumTestDeps();
    t.premium.getState().grantPremium({ ownedSinceMs: 1 });
    await startPremium(t.deps);
    expect(t.premium.getState().entitlement.isOwned).toBe(true);
  });

  it("revokes with the store's date on a refunded transaction", async () => {
    const t = createPremiumTestDeps({ transactions: [REFUNDED] });
    t.premium.getState().grantPremium({ ownedSinceMs: 1 });
    await startPremium(t.deps);
    expect(t.premium.getState().entitlement).toStrictEqual({
      isOwned: false,
      ownedSinceMs: 1,
      revokedAtMs: 1_700_000_000_000,
    });
  });

  it('asks the store for nothing when BUY is refused', async () => {
    const t = createPremiumTestDeps({ product: null });
    await startPremium(t.deps);
    await buyPremium(t.deps);
    expect(t.script.calls).not.toContain('requestPurchase');
  });
});

describe('premium service with an unacknowledged Android purchase', () => {
  it('finishes it once the launch re-check has saved Premium', async () => {
    const t = createPremiumTestDeps({ transactions: [UNFINISHED] });
    await startPremium(t.deps);
    expect(t.script.calls.slice(t.script.calls.indexOf('readTransactions'))).toStrictEqual([
      'readTransactions',
      'finish:t1',
    ]);
    expect(t.entitlements.saves).toHaveLength(1);
  });

  it('finishes it once a restore has saved Premium', async () => {
    const t = createPremiumTestDeps({ transactions: [UNFINISHED] });
    await restorePremium(t.deps);
    expect(t.script.calls).toStrictEqual(['restore', 'readTransactions', 'finish:t1']);
    expect(t.paywall.getState().didJustRestore).toBe(true);
  });

  it('leaves it unfinished while its save fails', async () => {
    const t = createPremiumTestDeps({ transactions: [UNFINISHED] });
    t.entitlements.failNextSave = { kind: 'storage-busy' };
    await startPremium(t.deps);
    expect(t.script.calls).not.toContain('finish:t1');
  });

  it('leaves alone a purchase the store already holds as finished', async () => {
    const t = createPremiumTestDeps({ transactions: [BOUGHT] });
    await startPremium(t.deps);
    await restorePremium(t.deps);
    expect(t.script.calls).not.toContain('finish:t1');
  });
});
