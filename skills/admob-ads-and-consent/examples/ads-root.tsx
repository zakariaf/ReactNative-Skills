// src/features/root-navigator/ads-root.tsx
// Mounts AdsProvider once, inside RootStack (GestureHandlerRootView -> MotionConfig -> navigation
// theme -> AdsRoot -> AppStack), so it sits inside the services, data, i18n and theme providers and
// the primer can use the app's UI. It reads the app's own facts: Premium from the premium store
// (in-app-purchases: usePremiumStore(selectIsPremium), so ads turn off the moment Premium is granted),
// onboarding from settings, and the saved consent answer from the app's ads state. The ads mode is
// the one the composition root used (the running config checked against the binary's own id).
import * as Application from 'expo-application';

import { useServices } from '@/services/services-context';
import { AdsProvider } from '@/services/ads/ads-provider';
import { readAdsExtraForBinary } from '@/services/ads/read-ads-extra';
import { AD_PACING } from '@/config/ad-pacing';
import { selectIsPremium } from '@/stores/premium/premium-selectors';
import { usePremiumStore } from '@/stores/premium/premium-store';
import { useOnboardingDone } from '@/stores/settings/use-onboarding-done';
import { useAdState } from '@/stores/ads/use-ad-state';

import { ConsentPrimer } from './consent-primer';

import type { ReactNode } from 'react';

export function AdsRoot({ children }: { readonly children: ReactNode }): ReactNode {
  const { ads, consent, connectivity, errorLog } = useServices();
  const adState = useAdState();
  return (
    <AdsProvider
      ads={ads}
      consent={consent}
      connectivity={connectivity}
      adsMode={readAdsExtraForBinary(Application.applicationId).adsMode}
      pacing={AD_PACING}
      isPremium={usePremiumStore(selectIsPremium)}
      isOnboardingDone={useOnboardingDone()}
      savedCanRequestAds={adState.consent.canRequestAds}
      // Saves the answer only when it changed (most launches write nothing).
      onConsent={adState.saveConsent}
      onError={(error) => {
        errorLog.record('service', error);
      }}
      renderPrimer={(onContinue) => <ConsentPrimer onContinue={onContinue} />}
    >
      {children}
    </AdsProvider>
  );
}
