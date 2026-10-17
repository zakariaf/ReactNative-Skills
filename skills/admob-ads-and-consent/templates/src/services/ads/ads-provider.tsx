// src/services/ads/ads-provider.tsx
// The consent moment and the ads dependencies, mounted once around the root stack (inside the
// services and theme providers, so the primer can use the app's UI). It runs Google's consent
// refresh once per launch and prepareAds (primer, form, ATT, initialize, preload) the first time an
// ad screen is open, and draws the app's primer full screen over the app while the flow asks for it.
// It is the only runner of prepareAds (check-ads rule consent-moment).
import { StyleSheet, View } from 'react-native';

import { AdsContext } from './ads-context';
import { useConsentMoment } from './use-consent-moment';

import type { ConsentMomentOptions } from './use-consent-moment';
import type { ReactNode } from 'react';

export type AdsProviderProps = Omit<ConsentMomentOptions, 'hasPrimer'> & {
  /** The app's consent primer (why a form appears next), or none: the form then opens at once. */
  readonly renderPrimer?: (onContinue: () => void) => ReactNode;
  readonly children: ReactNode;
};

const styles = StyleSheet.create({ fill: { flex: 1 }, cover: StyleSheet.absoluteFill });

/** Mount once, inside the app's providers and around the root stack. */
export function AdsProvider({ renderPrimer, children, ...options }: AdsProviderProps): ReactNode {
  const model = useConsentMoment({ ...options, hasPrimer: renderPrimer !== undefined });
  const primer =
    model.isIntroShown && renderPrimer !== undefined ? renderPrimer(model.onContinue) : null;
  const isPrimerShown = primer !== null;
  // While the primer shows, the app behind it is hidden from VoiceOver (accessibilityViewIsModal)
  // and from TalkBack (importantForAccessibility on the sibling that holds the app).
  return (
    <AdsContext value={model.deps}>
      <View
        style={styles.fill}
        aria-hidden={isPrimerShown}
        importantForAccessibility={isPrimerShown ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {isPrimerShown ? (
        <View style={styles.cover} accessibilityViewIsModal>
          {primer}
        </View>
      ) : null}
    </AdsContext>
  );
}
