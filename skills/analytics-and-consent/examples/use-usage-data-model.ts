// src/features/settings/use-usage-data-model.ts
// The model behind the usage-data prompt and the settings row (a shape). The prompt appears once the
// user finished onboarding, while the answer is 'unknown', over a calm screen; both answers are one
// tap, and the settings row changes the answer at any time (withdrawing is as easy as giving).
import { useState } from 'react';

import { useT } from '@/i18n/t-context';
import { useAnalytics } from '@/services/analytics/analytics-context';

/** What the prompt and the row render. */
export type UsageDataModel = {
  readonly isPromptVisible: boolean;
  /** Translated prompt text and the two equal choices. */
  readonly promptBody: string;
  readonly shareLabel: string;
  readonly declineLabel: string;
  /** Translated row label and its current value ("On" / "Off"). */
  readonly rowLabel: string;
  readonly isSharing: boolean;
  readonly onShare: () => void;
  readonly onDecline: () => void;
  /** The settings switch: the same two calls. */
  readonly onToggle: (isOn: boolean) => void;
};

export function useUsageDataModel(isOnboardingDone: boolean): UsageDataModel {
  const t = useT();
  const analytics = useAnalytics();
  // The initializer may be the gate's first use: one synchronous kv-store read in this render.
  const [consent, setConsent] = useState(analytics.consent);
  const answer = (choice: 'granted' | 'denied'): void => {
    analytics.setConsent(choice);
    setConsent(choice);
  };
  return {
    isPromptVisible: isOnboardingDone && consent === 'unknown',
    promptBody: t('settings.usage-data.prompt-body'),
    shareLabel: t('settings.usage-data.share'),
    declineLabel: t('settings.usage-data.decline'),
    rowLabel: t('settings.usage-data.label'),
    isSharing: consent === 'granted',
    onShare: () => {
      answer('granted');
    },
    onDecline: () => {
      answer('denied');
    },
    onToggle: (isOn) => {
      answer(isOn ? 'granted' : 'denied');
    },
  };
}
