// server/src/subscriptions/entitlement-doc.test.ts
import { resolvePlan } from './entitlement-doc';

import type { EntitlementDoc } from './entitlement-doc';

const NOW = 1_800_000_000_000;

function doc(overrides: Partial<EntitlementDoc>): EntitlementDoc {
  return {
    entitlementId: 'premium',
    status: 'active',
    productId: 'com.example.tasks.premium.monthly',
    store: 'app_store',
    isSandbox: false,
    expiresAtMs: NOW + 1,
    graceUntilMs: null,
    updatedAtMs: NOW,
    sourceEventId: 'e1',
    ...overrides,
  };
}

describe('resolvePlan', () => {
  it('is premium while active or cancelled but not yet expired', () => {
    expect(resolvePlan(doc({}), NOW)).toBe('premium');
    expect(resolvePlan(doc({ status: 'cancelled-active' }), NOW)).toBe('premium');
    expect(resolvePlan(doc({ expiresAtMs: null }), NOW)).toBe('premium');
  });

  it('is free exactly at the expiry instant and after it, even without an expiration event', () => {
    expect(resolvePlan(doc({ expiresAtMs: NOW }), NOW)).toBe('free');
    expect(resolvePlan(doc({ status: 'cancelled-active', expiresAtMs: NOW - 1 }), NOW)).toBe(
      'free',
    );
  });

  it('is premium during a grace period and free when it ends', () => {
    const grace = doc({ status: 'grace', expiresAtMs: NOW - 1, graceUntilMs: NOW + 1 });
    expect(resolvePlan(grace, NOW)).toBe('premium');
    expect(resolvePlan(grace, NOW + 1)).toBe('free');
  });

  it.each(['billing-retry', 'expired', 'refunded', 'none'] as const)('is free for %s', (status) => {
    expect(resolvePlan(doc({ status }), NOW)).toBe('free');
  });

  it.each([
    null,
    undefined,
    'premium',
    {},
    { status: 'gold' },
    { status: 'active', expiresAtMs: 'soon', graceUntilMs: null },
  ])('is free for a missing or malformed record (%p)', (value) => {
    expect(resolvePlan(value, NOW)).toBe('free');
  });
});
