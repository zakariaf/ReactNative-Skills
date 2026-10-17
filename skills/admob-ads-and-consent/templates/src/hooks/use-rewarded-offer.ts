// src/hooks/use-rewarded-offer.ts
// How a reward the user may earn by watching an ad is offered, live: it follows the rewarded ad
// (loading, ready, unavailable), connectivity, consent and Premium. 'watch-ad' runs earnRewardedPerk
// from the press handler; 'hidden' means the reward cannot be had.
import { useSyncExternalStore } from 'react';

import { useAds } from '@/services/ads/ads-context';
import { rewardedOffer } from '@/services/ads/rewarded-offer';

import { useAdContext } from './use-ad-context';

import type { AdFacts } from './use-ad-context';
import type { RewardedStatus } from '@/services/ads/ads-port';
import type { RewardedOffer, RewardedPerk } from '@/services/ads/rewarded-offer';

const NEVER = (): (() => void) => () => undefined;
const UNAVAILABLE = (): RewardedStatus => 'unavailable';

/** The offer of `perk`; outside AdsProvider only Premium and a free allowance make it free. */
export function useRewardedOffer(perk: RewardedPerk, facts: AdFacts): RewardedOffer {
  const deps = useAds();
  const context = useAdContext(facts);
  const rewardedStatus = useSyncExternalStore(
    deps?.ads.subscribeRewardedStatus ?? NEVER,
    deps?.ads.rewardedStatus ?? UNAVAILABLE,
  );
  if (deps === null)
    return perk.isAvailable && (facts.isPremium || perk.freeAllowanceLeft > 0) ? 'free' : 'hidden';
  return rewardedOffer(perk, { config: deps.config, context, rewardedStatus });
}
