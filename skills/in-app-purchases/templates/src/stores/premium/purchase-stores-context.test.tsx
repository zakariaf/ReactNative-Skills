// src/stores/premium/purchase-stores-context.test.tsx
// no-providers: this file tests PurchaseStoresProvider itself, so it mounts the provider under test
// as the wrapper; the last case proves the hooks' no-provider error.
import { act, renderHook } from '@testing-library/react-native';

import { createFakeEntitlementRepository } from '@/data/entitlements/fake-entitlement-repository';
import { createPaywallStore, usePaywallStore } from '@/stores/paywall/paywall-store';

import { selectIsPremium } from './premium-selectors';
import { createPremiumStore, usePremiumStore } from './premium-store';
import { PurchaseStoresProvider } from './purchase-stores-context';

import type { PremiumStore } from './premium-store';
import type { PaywallStore } from '@/stores/paywall/paywall-store';
import type { ReactNode } from 'react';

function wrapperFor(premium: PremiumStore, paywall: PaywallStore) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <PurchaseStoresProvider premium={premium} paywall={paywall}>
        {children}
      </PurchaseStoresProvider>
    );
  };
}

describe('PurchaseStoresProvider', () => {
  it('renders a subscriber again when Premium is granted', async () => {
    const premium = createPremiumStore({ entitlements: createFakeEntitlementRepository() });
    const { result } = await renderHook(() => usePremiumStore(selectIsPremium), {
      wrapper: wrapperFor(premium, createPaywallStore()),
    });
    expect(result.current).toBe(false);
    await act(() => {
      expect(premium.getState().grantPremium({ ownedSinceMs: 1 }).ok).toBe(true);
    });
    expect(result.current).toBe(true);
  });

  it('hands the paywall flow down', async () => {
    const paywall = createPaywallStore();
    const premium = createPremiumStore({ entitlements: createFakeEntitlementRepository() });
    const { result } = await renderHook(() => usePaywallStore((state) => state.flow), {
      wrapper: wrapperFor(premium, paywall),
    });
    expect(result.current).toStrictEqual({ kind: 'loading' });
  });

  it('throws without the provider', async () => {
    await expect(renderHook(() => usePremiumStore(selectIsPremium))).rejects.toThrow(
      'needs a <PurchaseStoresProvider>',
    );
  });
});
