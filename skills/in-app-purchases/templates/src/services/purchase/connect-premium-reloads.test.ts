// src/services/purchase/connect-premium-reloads.test.ts
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { flushMicrotasks } from '@test/flush-microtasks';
import { BOUGHT, createPremiumTestDeps } from '@test/purchase/create-premium-test-deps';

import { connectPremiumReloads } from './connect-premium-reloads';
import { withConnectivity } from './connectivity-gated-purchase';
import { startPremium } from './premium-store-flow';

function setup(isOnline: boolean) {
  const t = createPremiumTestDeps();
  const connectivity = createFakeConnectivity(isOnline);
  const activeListeners = new Set<() => void>();
  const service = { ...t.deps, port: withConnectivity(t.port, connectivity.isOnline) };
  const stop = connectPremiumReloads({
    connectivity,
    onAppActive: (listener) => {
      activeListeners.add(listener);
      return () => activeListeners.delete(listener);
    },
    service,
  });
  const comeToForeground = (): void => {
    for (const listener of activeListeners) listener();
  };
  return { ...t, connectivity, service, stop, comeToForeground, activeListeners };
}

describe('connectPremiumReloads', () => {
  it('loads the price once the first network report says online', async () => {
    const t = setup(false);
    await startPremium(t.service);
    expect(t.paywall.getState().flow).toStrictEqual({ kind: 'unavailable' });
    t.connectivity.setOnline(true);
    await flushMicrotasks();
    expect(t.paywall.getState().flow).toStrictEqual({ kind: 'ready', price: '$2.99' });
  });

  it('rechecks Premium after an offline start, so a refund is revoked', async () => {
    const t = setup(false);
    t.premium.getState().grantPremium({ ownedSinceMs: 1 });
    t.script.transactions = [{ ...BOUGHT, revocationDateMs: 5_000 }];
    await startPremium(t.service);
    expect(t.premium.getState().entitlement.isOwned).toBe(true);
    t.connectivity.setOnline(true);
    await flushMicrotasks();
    expect(t.premium.getState().entitlement.isOwned).toBe(false);
  });

  it('rechecks when the app returns to the foreground online', async () => {
    const t = setup(true);
    t.script.transactions = [BOUGHT];
    t.comeToForeground();
    await flushMicrotasks();
    expect(t.premium.getState().entitlement.isOwned).toBe(true);
  });

  it('reloads nothing while a purchase is in flight', async () => {
    const t = setup(true);
    await startPremium(t.service);
    t.paywall.getState().dispatch({ type: 'start-purchase', isPremium: false });
    t.script.calls.length = 0;
    t.connectivity.setOnline(false);
    await flushMicrotasks();
    expect(t.script.calls).toStrictEqual([]);
    expect(t.paywall.getState().flow.kind).toBe('purchasing');
  });

  it('unsubscribes from both sources', () => {
    const t = setup(true);
    t.stop();
    expect(t.connectivity.listenerCount()).toBe(0);
    expect(t.activeListeners.size).toBe(0);
  });
});
