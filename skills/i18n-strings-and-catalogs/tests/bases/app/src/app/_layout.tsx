// src/app/_layout.tsx (fixture: the root layout renders the I18nProvider; titled screens live in a group layout)
import { getLocales } from 'expo-localization';
import { Slot } from 'expo-router';

import { I18nProvider } from '@/i18n/i18n-provider';
import { resolveLanguage } from '@/i18n/resolve-language';

function reportI18nError(error: Error): void {
  console.warn(error.message);
}

export default function RootLayout(): React.JSX.Element {
  return (
    <I18nProvider language={resolveLanguage(null, getLocales())} digits="automatic" onError={reportI18nError}>
      <Slot />
    </I18nProvider>
  );
}
