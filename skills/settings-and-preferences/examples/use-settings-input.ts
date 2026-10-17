// src/features/settings/use-settings-input.ts (shape only): gathers what useSettingsModel needs
// from outside the settings store. Each fact comes from its owner; the model and the rows stay pure.
import { useQueryClient } from '@tanstack/react-query'; // networking-and-server-state (leave out without it)
import { useLocales } from 'expo-localization';

import { useAppData } from '@/data/app-data-context'; // persistence-and-migrations
import { err } from '@/core/result';
import { useDirection } from '@/i18n/direction-context'; // rtl-and-direction: the layout's direction now
import { playUiFeedback } from '@/services/feedback/ui-feedback'; // audio-and-haptics-feedback
import { useServices } from '@/services/services-context';
import { selectIsPrivacyChoicesRequired } from '@/stores/consent/consent-selectors'; // admob-ads-and-consent
import { useConsentStore } from '@/stores/consent/consent-store-context';
import { selectIsPremium } from '@/stores/premium/premium-selectors'; // in-app-purchases
import { usePremiumStore } from '@/stores/premium/premium-store-context';
import { selectIsSignedIn } from '@/stores/session/session-selectors'; // auth-and-secure-storage
import { useSessionStore } from '@/stores/session/session-store-context';
import { useStores } from '@/stores/stores-context'; // state-management-zustand
import { updateAndPublish } from '@/stores/update-and-publish';

import type { SettingsModelInput } from './use-settings-model';
import type { Language } from '@/i18n/languages';

export function useSettingsInput(onRestartNeeded: (language: Language) => void): SettingsModelInput {
  const services = useServices();
  const data = useAppData();
  const stores = useStores();
  const queryClient = useQueryClient();
  return {
    context: {
      isSignedIn: useSessionStore(selectIsSignedIn), // an app without accounts passes false
      canVibrate: services.haptics.isSupported, // audio-and-haptics-feedback: false on most iPads
      isPremium: usePremiumStore(selectIsPremium),
      hasPrivacyChoices: useConsentStore(selectIsPrivacyChoicesRequired),
    },
    deviceLocales: useLocales(), // re-renders when Android changes the language live
    layoutDirection: useDirection(),
    onRestartNeeded,
    // The switches' toggle moment (sound and pulse through the ports, which read the settings).
    onToggled: () => {
      playUiFeedback(services, 'toggle');
    },
    dataResets: {
      // One transaction that keeps the protected tables (the settings are not in the database at
      // all), then every store re-reads. AppData's reset returns Result<void, StorageFailure>
      // (persistence-and-migrations; the raw error is already recorded as 'storage'), so its
      // failure is mapped to this screen's DataResetFailure here, at the boundary.
      deleteAllData: () =>
        updateAndPublish(stores, () => {
          const reset = data.resetAllData();
          return reset.ok ? reset : err({ kind: 'data-not-deleted' });
        }),
      refetchServerState: () => {
        queryClient.invalidateQueries().catch((error: unknown) => {
          data.errorLog.record('network', error);
        });
      },
    },
  };
}
