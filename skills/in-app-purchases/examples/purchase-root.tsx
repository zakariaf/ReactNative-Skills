// src/features/root-navigator/purchase-root.tsx
// Shape to imitate (not a template): the piece of the startup that sells Premium. AppRoot renders it
// inside the services and data providers, around the root stack. It assumes three members an app adds
// when it adopts the skills: services.connectivity and services.purchase (examples/create-device-services.ts)
// and data.entitlements (createSqliteEntitlementRepository on AppData, persistence-and-migrations).
// Depth: AppRoot already nests its providers close to the canonical react/jsx-max-depth of 5, so AppRoot
// renders one small wrapper (<PurchaseRoot><RootStack /></PurchaseRoot>) instead of inlining the
// purchase provider among the others; the provider stack then stays within the limit.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { PREMIUM_PRODUCT_ID } from '@/config/purchase-products';
import { useAppData } from '@/data/app-data-context';
import { connectPremiumReloads } from '@/services/purchase/connect-premium-reloads';
import { startPremium } from '@/services/purchase/premium-store-flow';
import { storePriceText } from '@/services/purchase/store-price-text';
import { useServices } from '@/services/services-context';
import { openPurchaseStores } from '@/stores/premium/open-purchase-stores';
import { PurchaseStoresProvider } from '@/stores/premium/purchase-stores-context';

import type { PremiumServiceDeps } from '@/services/purchase/premium-service';
import type { ReactNode } from 'react';

export type PurchaseRootProps = { readonly children: ReactNode };

export function PurchaseRoot({ children }: PurchaseRootProps): ReactNode {
  const services = useServices();
  const data = useAppData();
  // Once per app start, after the data layer opened (the premium store hydrates synchronously).
  const [purchase] = useState(() => {
    const stores = openPurchaseStores({ entitlements: data.entitlements });
    const deps: PremiumServiceDeps = {
      port: services.purchase, // gated by connectivity where it was created
      productId: PREMIUM_PRODUCT_ID,
      premium: stores.premium,
      paywall: stores.paywall,
      nowMs: services.clock.nowMs,
      // The store's own displayPrice: the text the purchase sheet shows, in the device's locale.
      formatPrice: storePriceText,
      onError: (error) => {
        services.errorLog.record('service', error);
      },
    };
    return { stores, deps };
  });

  // After the first frame, never awaited by it: listen -> connect -> price -> silent re-check, then
  // keep it fresh (startPremium runs before the first network report arrives).
  useEffect(() => {
    const { deps } = purchase;
    // startPremium resolves after the store answered; a cleanup that ran first (StrictMode's double
    // mount, Fast Refresh) must still drop that listener, or every purchase event runs twice.
    let isCancelled = false;
    let stopListening: (() => void) | null = null;
    startPremium(deps)
      .then((unsubscribe) => {
        if (isCancelled) unsubscribe();
        else stopListening = unsubscribe;
      })
      .catch(deps.onError);
    const stopReloads = connectPremiumReloads({
      connectivity: services.connectivity,
      onAppActive: (listener) => {
        const subscription = AppState.addEventListener('change', (next) => {
          if (next === 'active') listener();
        });
        return () => {
          subscription.remove();
        };
      },
      service: deps,
    });
    return () => {
      isCancelled = true;
      stopReloads();
      stopListening?.();
    };
  }, [purchase, services.connectivity]);

  return (
    <PurchaseStoresProvider premium={purchase.stores.premium} paywall={purchase.stores.paywall}>
      {children}
    </PurchaseStoresProvider>
  );
}
