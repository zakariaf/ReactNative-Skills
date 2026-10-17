// src/features/tasks/use-tasks-model.ts
// The ads calls of a feature's model hook (a shape): the banner slot of the task list, the natural
// break (the user finished reviewing today's list), the interstitial that may follow it from the
// press handler, and a rewarded offer ("Watch an ad to unlock a theme for today"). The list stays
// mounted under every screen pushed over it, so the banner slot gets the screen's focus. In the app
// these members join the rest of useTasksModel's return value (the hook keeps its file's name).
import { useIsFocused } from 'expo-router';

import { useBannerSlot } from '@/hooks/use-banner-slot';
import { useRewardedOffer } from '@/hooks/use-rewarded-offer';
import { useAdContext } from '@/hooks/use-ad-context';
import { recordBreak } from '@/services/ads/ad-history';
import { earnRewardedPerk, showInterstitialIfDue } from '@/services/ads/ad-moments';
import { useAds } from '@/services/ads/ads-context';
import { useServices } from '@/services/services-context';
import { useAdState } from '@/stores/ads/use-ad-state';
import { selectIsPremium } from '@/stores/premium/premium-selectors';
import { usePremiumStore } from '@/stores/premium/premium-store';
import { useOnboardingDone } from '@/stores/settings/use-onboarding-done';

import type { BannerSlotModel } from '@/hooks/use-banner-slot';
import type { RewardedOffer } from '@/services/ads/rewarded-offer';

export type TasksModel = {
  readonly banner: BannerSlotModel;
  readonly themeOffer: RewardedOffer;
  readonly onReviewDone: () => void;
  readonly onWatchAdForTheme: () => void;
};

export function useTasksModel(): TasksModel {
  const { clock, fullscreenAd, errorLog } = useServices();
  const deps = useAds();
  const adState = useAdState();
  const isFocused = useIsFocused();
  const facts = {
    isPremium: usePremiumStore(selectIsPremium),
    isOnboardingDone: useOnboardingDone(),
    breaksCompletedTotal: adState.breaksCompletedTotal,
  };
  const context = useAdContext(facts);
  const reportError = (error: unknown): void => {
    errorLog.record('service', error);
  };
  // The natural break: count it with the break itself, then maybe show an interstitial, from the
  // press handler (never from an effect).
  const finishReview = async (): Promise<void> => {
    const counted = recordBreak(adState.history, 'success');
    adState.saveBreak(counted);
    if (deps === null) return;
    const history = await showInterstitialIfDue(
      { ads: deps.ads, lifecycle: fullscreenAd },
      {
        config: deps.config,
        context,
        history: counted,
        trigger: { outcome: 'success', nowMs: clock.nowMs() },
      },
    );
    adState.saveHistory(history);
  };
  const watchAdForTheme = async (): Promise<void> => {
    if (deps !== null && (await earnRewardedPerk({ ads: deps.ads, lifecycle: fullscreenAd }))) {
      adState.unlockThemeForToday();
    }
  };
  return {
    banner: useBannerSlot('tasks', facts, isFocused),
    themeOffer: useRewardedOffer(
      { isAvailable: !adState.isThemeUnlocked, freeAllowanceLeft: 0, waitsWhileLoading: false },
      facts,
    ),
    onReviewDone: () => {
      finishReview().catch(reportError);
    },
    onWatchAdForTheme: () => {
      watchAdForTheme().catch(reportError);
    },
  };
}
