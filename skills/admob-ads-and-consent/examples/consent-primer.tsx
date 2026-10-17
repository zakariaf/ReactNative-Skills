// src/features/root-navigator/consent-primer.tsx
// The app's optional consent primer (a shape): shown full screen by AdsProvider right before Google's
// form, only where the form is required, telling the user why a form appears. Its copy comes from
// the catalogs; Continue opens Google's form. It never asks for anything itself and never decides
// for the user: the choice is made in Google's form.
import { View } from 'react-native';

import { useT } from '@/i18n/t-context';
import { AppText } from '@/ui/app-text';
import { PrimaryButton } from '@/ui/primary-button';

import type { ReactNode } from 'react';

export function ConsentPrimer({ onContinue }: { readonly onContinue: () => void }): ReactNode {
  const t = useT();
  return (
    <View testID="consent.primer">
      <AppText role="header">{t('consent.primer.title')}</AppText>
      <AppText>{t('consent.primer.body')}</AppText>
      <PrimaryButton
        testID="consent.primer-continue-button"
        label={t('consent.primer.continue')}
        onPress={onContinue}
      />
    </View>
  );
}
