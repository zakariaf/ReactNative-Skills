// src/services/subscription/subscription-identity.test.ts
import { err, ok } from '@/core/result';

import { createFakeSubscription, createFakeSubscriptionScript } from './fake-subscription';
import { createSubscriptionIdentity } from './subscription-identity';

describe('createSubscriptionIdentity', () => {
  it('configures once with the first user id, then logs in on every change', async () => {
    const script = createFakeSubscriptionScript();
    const identity = createSubscriptionIdentity(createFakeSubscription(script));
    await identity.onUserChanged('user-1');
    await identity.onUserChanged('user-1');
    await identity.onUserChanged('user-2');
    expect(script.calls).toStrictEqual(['configure:user-1', 'logIn:user-2']);
    expect(identity.currentUserId()).toBe('user-2');
  });

  it('logs out on sign-out and sells nothing until the next user', async () => {
    const script = createFakeSubscriptionScript();
    const identity = createSubscriptionIdentity(createFakeSubscription(script));
    await identity.onUserChanged('user-1');
    await expect(identity.onUserChanged(null)).resolves.toStrictEqual(ok(undefined));
    expect(identity.currentUserId()).toBeNull();
    await identity.onUserChanged('user-3');
    expect(script.calls).toStrictEqual(['configure:user-1', 'logOut', 'logIn:user-3']);
  });

  it('configures nothing before a user exists', async () => {
    const script = createFakeSubscriptionScript();
    const identity = createSubscriptionIdentity(createFakeSubscription(script));
    await identity.onUserChanged(null);
    expect(script.calls).toStrictEqual([]);
  });

  it('keeps no user when logIn fails, so the paywall cannot sell for the previous one', async () => {
    const script = createFakeSubscriptionScript();
    const identity = createSubscriptionIdentity(createFakeSubscription(script));
    await identity.onUserChanged('user-1');
    script.failures.logIn = 'network';
    await expect(identity.onUserChanged('user-2')).resolves.toStrictEqual(
      err({ kind: 'network', code: 'fake-network' }),
    );
    expect(identity.currentUserId()).toBeNull();
  });

  it('runs changes one at a time, in order', async () => {
    const script = createFakeSubscriptionScript();
    const identity = createSubscriptionIdentity(createFakeSubscription(script));
    await Promise.all([
      identity.onUserChanged('user-1'),
      identity.onUserChanged('user-2'),
      identity.onUserChanged(null),
    ]);
    expect(script.calls).toStrictEqual(['configure:user-1', 'logIn:user-2', 'logOut']);
  });
});
