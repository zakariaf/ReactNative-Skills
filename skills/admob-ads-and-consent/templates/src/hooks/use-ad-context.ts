// src/hooks/use-ad-context.ts
// The live facts every ad decision needs, read the same way on every screen: online from the
// ConnectivityPort, the consent answer from the consent moment (true only once prepareAds finished
// this session), and the app's own facts from the caller's stores. Screens never build an AdContext
// by hand; the pure policy (ad-policy.ts) decides with it.
import { useSyncExternalStore } from 'react';

import { useAds } from '@/services/ads/ads-context';

import type { AdContext } from '@/services/ads/ad-policy';

/** The app's own facts, read by the feature's model hook from its stores. */
export type AdFacts = {
  readonly isPremium: boolean;
  readonly isOnboardingDone: boolean;
  readonly breaksCompletedTotal: number;
};

const NEVER = (): (() => void) => () => undefined;
const OFFLINE = (): boolean => false;
const UNASKED = (): null => null;

/** The live AdContext; outside AdsProvider nothing may be served (offline, no consent). */
export function useAdContext(facts: AdFacts): AdContext {
  const deps = useAds();
  const isOnline = useSyncExternalStore(
    deps?.connectivity.subscribe ?? NEVER,
    deps?.connectivity.isOnline ?? OFFLINE,
  );
  const canRequestAds = useSyncExternalStore(
    deps?.flow.subscribe ?? NEVER,
    deps === null ? UNASKED : () => deps.flow.getSnapshot().canRequestAds,
  );
  return { ...facts, isOnline: deps !== null && isOnline, canRequestAds: canRequestAds === true };
}
