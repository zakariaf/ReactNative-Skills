// src/services/ads/rewarded-offer.ts
// How a reward the user may earn by watching an ad is offered ("Watch an ad to unlock a theme for
// today"): always the user's choice, behind a clear label. 'loading' is an offer whose rewarded ad
// is still on its way (drawn busy, not pressable); 'hidden' always means the reward cannot be had,
// so a flow that waits for the offer must move on when it turns hidden (never a dead end).
import { canServeAds } from './ad-policy';

import type { AdContext, AdPolicyConfig } from './ad-policy';
import type { RewardedStatus } from './ads-port';

/** How the offer is drawn. */
export type RewardedOffer = 'free' | 'watch-ad' | 'loading' | 'hidden';

/** One reward, as the feature describes it. */
export type RewardedPerk = {
  /** False when the reward does not apply right now (already used, not allowed): hidden for all. */
  readonly isAvailable: boolean;
  /** Free uses left (a daily allowance from the app's config); 0 when there is none. */
  readonly freeAllowanceLeft: number;
  /** True when the user is waiting on this offer (show it busy while the ad loads); else hide it. */
  readonly waitsWhileLoading: boolean;
};

/** The facts the offer depends on. */
export type RewardedOfferRequest = {
  readonly config: AdPolicyConfig;
  readonly context: AdContext;
  /** AdsPort.rewardedStatus(), read through subscribeRewardedStatus. */
  readonly rewardedStatus: RewardedStatus;
};

/** A rewarded ad's offer: ready offers it, loading waits (when the perk waits), anything else hides. */
function adOffer(perk: RewardedPerk, status: RewardedStatus): RewardedOffer {
  if (status === 'ready') return 'watch-ad';
  return status === 'loading' && perk.waitsWhileLoading ? 'loading' : 'hidden';
}

/** Premium and a free allowance make the reward free; otherwise an ad that can come earns it. */
export function rewardedOffer(
  perk: RewardedPerk,
  { config, context, rewardedStatus }: RewardedOfferRequest,
): RewardedOffer {
  if (!perk.isAvailable) return 'hidden';
  if (context.isPremium || perk.freeAllowanceLeft > 0) return 'free';
  // Offline, no consent or no ad that can come: hide the offer, never show a broken one.
  return canServeAds(config, context) ? adOffer(perk, rewardedStatus) : 'hidden';
}
