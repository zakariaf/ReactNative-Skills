// src/features/settings/components/ad-privacy-row.tsx
// The "Ad privacy choices" entry point (a shape): a pure view of the settings model's adPrivacy
// (use-settings-model.ts reads the consent answer and the ConsentPort). It is absent, never greyed
// out, while Google says privacy options are not required. Its look belongs to the settings screen
// (settings-and-preferences); this skill owns when it shows and what it calls.
import { SettingsRow } from '@/ui/settings-row';

import type { ReactNode } from 'react';

/** What the settings model hands the row. */
export type AdPrivacyModel = {
  /** True only while Google requires the entry point (isPrivacyOptionsRequired). */
  readonly isVisible: boolean;
  /** Reopens Google's privacy-options form; the answer may turn ads off. */
  readonly onPress: () => void;
};

export function AdPrivacyRow({ isVisible, onPress }: AdPrivacyModel): ReactNode {
  if (!isVisible) return null;
  return (
    <SettingsRow
      testID="settings.ad-privacy-row"
      labelKey="settings.ad-privacy.label"
      onPress={onPress}
    />
  );
}
