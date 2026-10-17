// src/services/purchase/connectivity-gated-purchase.test.ts
import { err, ok } from '@/core/result';
import { createPremiumTestDeps, TEST_PRODUCT_ID } from '@test/purchase/create-premium-test-deps';

import { withConnectivity } from './connectivity-gated-purchase';
import { loadStore, shouldReloadStore } from './premium-store-flow';

describe('withConnectivity', () => {
  it('reports the store unavailable offline without asking it', async () => {
    const t = createPremiumTestDeps();
    const port = withConnectivity(t.port, () => false);
    await expect(port.connect()).resolves.toStrictEqual(ok(false));
    await expect(port.fetchProduct(TEST_PRODUCT_ID)).resolves.toStrictEqual(ok(null));
    await expect(port.restore()).resolves.toStrictEqual(
      err({ kind: 'store-error', code: 'offline' }),
    );
    await expect(port.readTransactions()).resolves.toStrictEqual(ok([]));
    expect(t.script.calls).toStrictEqual([]);
  });

  it('passes every call through while online', async () => {
    const t = createPremiumTestDeps();
    const port = withConnectivity(t.port, () => true);
    await port.connect();
    await port.restore();
    expect(t.script.calls).toStrictEqual(['connect', 'restore']);
  });

  it('turns the paywall into "store unavailable" while offline', async () => {
    const t = createPremiumTestDeps();
    await loadStore({ ...t.deps, port: withConnectivity(t.port, () => false) });
    expect(t.paywall.getState().flow).toStrictEqual({ kind: 'unavailable' });
  });
});

describe('shouldReloadStore', () => {
  it.each([
    ['unavailable', true, true],
    ['ready', true, false],
    ['ready', false, true],
    ['restore-failed', false, true],
    ['purchasing', false, false],
    ['pending', false, false],
    ['restoring', false, false],
    ['loading', false, false],
  ] as const)('answers %s online=%s with %s', (flow, isOnline, shouldReload) => {
    expect(shouldReloadStore(flow, isOnline)).toBe(shouldReload);
  });
});
