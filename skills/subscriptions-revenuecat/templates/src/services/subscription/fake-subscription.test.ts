// src/services/subscription/fake-subscription.test.ts
import { err, ok } from '@/core/result';

import { createFakeSubscription, createFakeSubscriptionScript } from './fake-subscription';
import { NO_ENTITLEMENT } from './subscription-port';

describe('createFakeSubscription', () => {
  it('answers from the script and logs every call in order', async () => {
    const script = createFakeSubscriptionScript();
    const port = createFakeSubscription(script);
    expect(port.configure('user-1')).toStrictEqual(ok(undefined));
    await expect(port.getOffer()).resolves.toStrictEqual(ok(null));
    const bought = await port.purchase('$rc_monthly');
    expect(bought.ok && bought.value.isActive).toBe(true);
    expect(script.calls).toStrictEqual(['configure:user-1', 'getOffer', 'purchase:$rc_monthly']);
  });

  it('fails the scripted methods with their kind', async () => {
    const script = createFakeSubscriptionScript({
      failures: { purchase: 'cancelled', restore: 'network' },
    });
    const port = createFakeSubscription(script);
    await expect(port.purchase('$rc_annual')).resolves.toStrictEqual(
      err({ kind: 'cancelled', code: 'fake-cancelled' }),
    );
    await expect(port.restore()).resolves.toStrictEqual(
      err({ kind: 'network', code: 'fake-network' }),
    );
    await expect(port.getEntitlement()).resolves.toStrictEqual(ok(NO_ENTITLEMENT));
  });

  it('delivers changes to listeners until they unsubscribe', () => {
    const port = createFakeSubscription(createFakeSubscriptionScript());
    const seen: boolean[] = [];
    const stop = port.onEntitlementChange((entitlement) => {
      seen.push(entitlement.isActive);
    });
    port.emit({ ...NO_ENTITLEMENT, isActive: true });
    stop();
    port.emit(NO_ENTITLEMENT);
    expect(seen).toStrictEqual([true]);
    expect(port.listenerCount()).toBe(0);
  });
});
