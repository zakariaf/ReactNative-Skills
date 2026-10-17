// src/services/purchase/premium-service.test.ts — EXAMPLE (a shape to imitate): a service tested over
// fakes. One shared call log proves cross-service order with a single assertion: the entitlement is
// stored before the store transaction is finished, so a crash in between never loses a purchase.
// Every failure is a script value (a refused save, a failed restore sync), because the failure paths
// are where that order matters: a finished but unsaved purchase is lost for good, while an unfinished
// one is delivered again by the store at the next launch.
import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakePurchase } from './fake-purchase';
import { createPremiumService } from './premium-service';

import type { FakePurchaseScript } from './fake-purchase';
import type { StoreTransaction } from './purchase-port';

const PRODUCT_ID = 'tasks.premium';
/** A new purchase as the store delivers it: paid, not yet finished (acknowledged, on Play). */
const BOUGHT: StoreTransaction = {
  productId: PRODUCT_ID,
  transactionId: 't1',
  state: 'purchased',
  revokedAtMs: null,
  isFinished: false,
};
/** The same purchase once finished, as a later launch reads it. */
const FINISHED: StoreTransaction = { ...BOUGHT, isFinished: true };

type SetupOptions = {
  readonly purchase?: Partial<FakePurchaseScript>;
  /** What the entitlement store answers: 'refused' is a write that did not reach the disk. */
  readonly save?: 'saved' | 'refused';
};

function setup({ purchase = {}, save = 'saved' }: SetupOptions = {}) {
  const script: FakePurchaseScript = {
    isConnected: true,
    product: { productId: PRODUCT_ID, displayPrice: '€4.99', price: 4.99, currency: 'EUR' },
    restoreResult: 'synced',
    transactions: [],
    calls: [],
    ...purchase,
  };
  const port = createFakePurchase(script);
  const service = createPremiumService({
    purchase: port,
    productId: PRODUCT_ID,
    saveEntitlement: (isPremium) => {
      script.calls.push(`save:${String(isPremium)}`);
      return Promise.resolve(save === 'saved');
    },
  });
  return { script, port, service };
}

describe('createPremiumService', () => {
  it('stores the entitlement before it finishes the transaction', async () => {
    const { script, port, service } = setup();
    await service.start();
    await service.buy();

    port.emit({ type: 'transaction', transaction: BOUGHT });
    await flushMicrotasks();

    const tail = script.calls.slice(script.calls.indexOf('requestPurchase'));
    expect(tail).toStrictEqual(['requestPurchase', 'save:true', 'finish:t1']);
  });

  it('leaves a purchase whose save was refused unfinished, so the store delivers it again', async () => {
    const { script, port, service } = setup({ save: 'refused' });
    await service.start();
    await service.buy();

    port.emit({ type: 'transaction', transaction: BOUGHT });
    await flushMicrotasks();

    const tail = script.calls.slice(script.calls.indexOf('requestPurchase'));
    expect(tail).toStrictEqual(['requestPurchase', 'save:true']);
  });

  it('reports the store as unavailable when it lists no product', async () => {
    const { service } = setup({ purchase: { product: null } });

    await service.start();

    expect(service.state()).toStrictEqual({ kind: 'store-unavailable' });
  });

  it('reports a failed restore sync as a failure, not as nothing to restore', async () => {
    const { service } = setup({ purchase: { restoreResult: 'sync-failed' } });

    await expect(service.restore()).resolves.toStrictEqual({ kind: 'restore-failed' });
  });

  it('keeps the entitlement when the launch re-check sees no transactions', async () => {
    const { script, service } = setup({ purchase: { transactions: [] } });

    await service.start();

    expect(script.calls).not.toContain('save:false');
  });

  it('revokes only on an explicit revocation date', async () => {
    const { port, service } = setup();
    await service.start();

    port.emit({ type: 'transaction', transaction: { ...BOUGHT, state: 'pending' } });
    await flushMicrotasks();
    expect(service.state()).toStrictEqual({ kind: 'pending' });

    port.emit({ type: 'transaction', transaction: { ...BOUGHT, revokedAtMs: 1000 } });
    await flushMicrotasks();
    expect(service.state()).toStrictEqual({ kind: 'not-owned' });
  });

  // Play never delivers an unacknowledged purchase to the listener again and refunds it after three
  // days, so the launch re-check and a restore finish it, once the entitlement is saved.
  describe('when the store holds an unfinished purchase', () => {
    it('finishes it once the launch re-check has saved the entitlement', async () => {
      const { script, service } = setup({ purchase: { transactions: [BOUGHT] } });

      await service.start();

      const tail = script.calls.slice(script.calls.indexOf('pendingTransactions'));
      expect(tail).toStrictEqual(['pendingTransactions', 'save:true', 'finish:t1']);
    });

    it('finishes it once a restore has saved the entitlement', async () => {
      const { script, service } = setup({ purchase: { transactions: [BOUGHT] } });

      await expect(service.restore()).resolves.toStrictEqual({ kind: 'restored' });
      expect(script.calls).toStrictEqual(['restore', 'pendingTransactions', 'save:true', 'finish:t1']);
    });

    it('leaves it unfinished while its save is refused', async () => {
      const { script, service } = setup({ purchase: { transactions: [BOUGHT] }, save: 'refused' });

      await service.start();

      expect(script.calls).not.toContain('finish:t1');
    });

    it('leaves alone a purchase the store already holds as finished', async () => {
      const { script, service } = setup({ purchase: { transactions: [FINISHED] } });

      await service.start();
      await service.restore();

      expect(script.calls).not.toContain('finish:t1');
    });
  });
});
