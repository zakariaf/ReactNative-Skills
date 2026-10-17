// src/services/ads/ads-context.ts
// What AdsProvider hands down: dependencies only (the ports, the consent moment's flow and the
// pacing of this build), never state. The hooks read the changing facts from the external stores
// (connectivity, the flow) with useSyncExternalStore, and the app's own facts come in as arguments.
import { createContext, use } from 'react';

import type { AdPolicyConfig } from './ad-policy';
import type { AdsPort } from './ads-port';
import type { ConsentMomentFlow } from './consent-moment-flow';
import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';

/** The ads dependencies of this app run. */
export type AdsDeps = {
  readonly ads: AdsPort;
  readonly connectivity: ConnectivityPort;
  readonly flow: ConsentMomentFlow;
  /** The pacing, with isAdsEnabled already false in an ADS_MODE=off build. */
  readonly config: AdPolicyConfig;
};

export const AdsContext = createContext<AdsDeps | null>(null);

/** The ads dependencies, or null outside AdsProvider (screen tests): no ad then. */
export function useAds(): AdsDeps | null {
  return use(AdsContext);
}
