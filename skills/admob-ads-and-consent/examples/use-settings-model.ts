// src/features/settings/use-settings-model.ts
// The ads part of the settings model hook (a shape): the only settings code that reads the consent
// answer and the ConsentPort. The screen passes `adPrivacy` to AdPrivacyRow, a pure view. In the
// app `adPrivacy` joins the rest of useSettingsModel's return value (the hook keeps its file name).
import { useServices } from '@/services/services-context';
import { useAdState } from '@/stores/ads/use-ad-state';

import type { AdPrivacyModel } from './components/ad-privacy-row';

export type SettingsModel = { readonly adPrivacy: AdPrivacyModel };

export function useSettingsModel(): SettingsModel {
  const { consent, errorLog } = useServices();
  const adState = useAdState();
  return {
    adPrivacy: {
      isVisible: adState.consent.isPrivacyOptionsRequired,
      onPress: () => {
        consent
          .showPrivacyOptions()
          .then(adState.saveConsent)
          .catch((error: unknown) => {
            errorLog.record('service', error);
          });
      },
    },
  };
}
