// src/services/subscription/fake-subscription.ts: a scripted SubscriptionPort for Jest and the dev build.
// It never touches a store: the script decides every answer, and every call is logged in order.
import { err, ok } from '@/core/result';

import { NO_ENTITLEMENT } from './subscription-port';

import type {
  ClientEntitlement,
  SubscriptionFailureKind,
  SubscriptionOffer,
  SubscriptionPort,
  SubscriptionResult,
} from './subscription-port';

export type FakeSubscriptionMethod =
  'configure' | 'logIn' | 'logOut' | 'getOffer' | 'purchase' | 'restore';

export type FakeSubscriptionScript = {
  readonly offer: SubscriptionOffer | null;
  /** The entitlement before any purchase. */
  readonly entitlement: ClientEntitlement;
  /** The entitlement a successful purchase or restore turns into. */
  readonly afterPurchase: ClientEntitlement;
  /** A method listed here fails with that kind (tests may change it between calls). */
  readonly failures: Partial<Record<FakeSubscriptionMethod, SubscriptionFailureKind>>;
  readonly calls: string[];
};

export type FakeSubscription = SubscriptionPort & {
  /** Pushes a customer info change to every listener, as the SDK does. */
  readonly emit: (entitlement: ClientEntitlement) => void;
  readonly listenerCount: () => number;
};

export function createFakeSubscriptionScript(
  overrides: Partial<FakeSubscriptionScript> = {},
): FakeSubscriptionScript {
  return {
    offer: null,
    entitlement: NO_ENTITLEMENT,
    afterPurchase: { ...NO_ENTITLEMENT, isActive: true, willRenew: true },
    failures: {},
    calls: [],
    ...overrides,
  };
}

type Answer = <TValue>(
  method: FakeSubscriptionMethod,
  call: string,
  value: () => TValue,
) => Promise<SubscriptionResult<TValue>>;

function answererFor(script: FakeSubscriptionScript): Answer {
  return (method, call, value) => {
    script.calls.push(call);
    const kind = script.failures[method];
    return Promise.resolve(kind === undefined ? ok(value()) : err({ kind, code: `fake-${kind}` }));
  };
}

export function createFakeSubscription(script: FakeSubscriptionScript): FakeSubscription {
  const listeners = new Set<(entitlement: ClientEntitlement) => void>();
  const answer = answererFor(script);
  let entitlement = script.entitlement;
  const grant = (): ClientEntitlement => {
    entitlement = script.afterPurchase;
    return entitlement;
  };
  return {
    configure: (appUserId) => {
      script.calls.push(`configure:${appUserId}`);
      const kind = script.failures.configure;
      return kind === undefined ? ok(undefined) : err({ kind, code: `fake-${kind}` });
    },
    logIn: (appUserId) => answer('logIn', `logIn:${appUserId}`, () => entitlement),
    logOut: () => answer('logOut', 'logOut', () => undefined),
    getOffer: () => answer('getOffer', 'getOffer', () => script.offer),
    purchase: (packageId) => answer('purchase', `purchase:${packageId}`, grant),
    restore: () => answer('restore', 'restore', grant),
    getEntitlement: () => Promise.resolve(ok(entitlement)),
    onEntitlementChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    managementUrl: () => Promise.resolve(ok(null)),
    emit: (next) => {
      entitlement = next;
      for (const listener of listeners) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}
