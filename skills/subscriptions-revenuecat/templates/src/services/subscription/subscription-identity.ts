// src/services/subscription/subscription-identity.ts: keeps the SDK's app user id equal to the backend user id.
// The composition root calls onUserChanged on every auth change (restore at launch, sign-in,
// account switch or merge, sign-out). The SDK is configured once, with the first user id, so it
// never creates an anonymous id; later changes go through logIn and logOut.
import { ok } from '@/core/result';

import type { SubscriptionPort, SubscriptionResult } from './subscription-port';

export type SubscriptionIdentity = {
  /** The signed-in backend user id, or null after sign-out. Calls run one at a time, in order. */
  readonly onUserChanged: (userId: string | null) => Promise<SubscriptionResult<void>>;
  /** The user the SDK acts for, or null: the paywall sells only while this is a user id. */
  readonly currentUserId: () => string | null;
};

export function createSubscriptionIdentity(port: SubscriptionPort): SubscriptionIdentity {
  let isConfigured = false;
  let current: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function signOut(): Promise<SubscriptionResult<void>> {
    if (current === null) return ok(undefined);
    current = null;
    return port.logOut();
  }

  async function switchTo(userId: string): Promise<SubscriptionResult<void>> {
    if (!isConfigured) {
      const configured = port.configure(userId);
      if (!configured.ok) return configured;
      isConfigured = true;
      current = userId;
      return ok(undefined);
    }
    // Until logIn succeeds the SDK may still act for the previous user: sell nothing meanwhile.
    current = null;
    const loggedIn = await port.logIn(userId);
    if (!loggedIn.ok) return loggedIn;
    current = userId;
    return ok(undefined);
  }

  function change(userId: string | null): Promise<SubscriptionResult<void>> {
    if (userId === current) return Promise.resolve(ok(undefined));
    return userId === null ? signOut() : switchTo(userId);
  }

  return {
    onUserChanged: (userId) => {
      const next = queue.then(() => change(userId));
      queue = next;
      return next;
    },
    currentUserId: () => current,
  };
}
