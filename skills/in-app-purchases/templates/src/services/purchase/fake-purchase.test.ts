// src/services/purchase/fake-purchase.test.ts
import { err, ok } from '@/core/result';

import { createFakePurchase } from './fake-purchase';

import type { FakePurchaseScript } from './fake-purchase';

function scriptWith(overrides: Partial<FakePurchaseScript> = {}): FakePurchaseScript {
  return {
    isConnected: true,
    product: null,
    restoreResult: 'synced',
    transactions: [],
    calls: [],
    ...overrides,
  };
}

describe('createFakePurchase', () => {
  it('answers from the script and logs every call in order', async () => {
    const script = scriptWith();
    const port = createFakePurchase(script);
    await expect(port.connect()).resolves.toStrictEqual(ok(true));
    await expect(port.restore()).resolves.toStrictEqual(ok(undefined));
    await port.requestPurchase('p');
    expect(script.calls).toStrictEqual(['connect', 'restore', 'requestPurchase']);
  });

  it('answers store errors when the script says so', async () => {
    const port = createFakePurchase(scriptWith({ restoreResult: 'sync-failed', readFails: true }));
    const failure = err({ kind: 'store-error', code: 'unknown' });
    await expect(port.restore()).resolves.toStrictEqual(failure);
    await expect(port.readTransactions()).resolves.toStrictEqual(failure);
  });

  it('delivers events to subscribers until they unsubscribe', () => {
    const port = createFakePurchase(scriptWith());
    const seen: string[] = [];
    const stop = port.subscribe((event) => seen.push(event.type));
    port.emit({ type: 'failure', failure: 'cancelled', code: 'user-cancelled' });
    stop();
    port.emit({ type: 'failure', failure: 'cancelled', code: 'user-cancelled' });
    expect(seen).toStrictEqual(['failure']);
    expect(port.listenerCount()).toBe(0);
  });
});
