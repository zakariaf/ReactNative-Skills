// src/services/purchase/connect-premium-reloads.ts: keeps the store fresh after startup (connectivity and foreground).
// startPremium runs before the first network report (the connectivity adapter starts offline), so
// without these two subscriptions the price never loads after an offline start and a refund waits
// for the next launch.
import { recheckPremium } from './premium-service';
import { loadStore, shouldReloadStore } from './premium-store-flow';

import type { PremiumServiceDeps } from './premium-service';
import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';

export type PremiumReloadsDeps = {
  readonly connectivity: Pick<ConnectivityPort, 'isOnline' | 'subscribe'>;
  /**
   * Calls `listener` each time the app returns to the foreground; returns the unsubscribe. The
   * composition root builds it on AppState ('change' to 'active'), so this module stays pure.
   */
  readonly onAppActive: (listener: () => void) => () => void;
  readonly service: PremiumServiceDeps;
};

/** Called by the composition root right after startPremium; returns one unsubscribe for both. */
export function connectPremiumReloads(deps: PremiumReloadsDeps): () => void {
  const { connectivity, onAppActive, service } = deps;
  const stopConnectivity = connectivity.subscribe((isOnline) => {
    if (!shouldReloadStore(service.paywall.getState().flow.kind, isOnline)) return;
    // Back online: the launch re-check ran offline (absence is not evidence), so re-check now.
    const reload = loadStore(service);
    const done = isOnline ? reload.then(async () => recheckPremium(service)) : reload;
    done.catch(service.onError);
  });
  const stopActive = onAppActive(() => {
    // A refund or an Ask to Buy approval may have happened while the app was away.
    if (connectivity.isOnline()) recheckPremium(service).catch(service.onError);
  });
  return () => {
    stopConnectivity();
    stopActive();
  };
}
