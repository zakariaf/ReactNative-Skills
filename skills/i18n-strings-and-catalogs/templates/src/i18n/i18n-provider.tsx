// src/i18n/i18n-provider.tsx
import { useEffect } from 'react';
import { IntlProvider } from 'react-intl';

import { localeTagFor } from './digits';
import { LanguageContext } from './language-context';
import { SOURCE_LANGUAGE } from './languages';
import { messagesFor } from './messages';
import { TBridge } from './t-bridge';
import { recordShownLanguage } from './translate-now';

import type { DigitStyle } from './digits';
import type { Language } from './languages';
import type { ReactNode } from 'react';

export type I18nProviderProps = {
  readonly language: Language;
  readonly digits: DigitStyle;
  /** ErrorLogPort.record('i18n', error) in the app; a throwing function in tests. */
  readonly onError: (error: Error) => void;
  readonly children: ReactNode;
};

/**
 * IntlProvider (locale tag with the numbering system, this language's catalog) + LanguageContext +
 * TBridge, which puts t() into TContext. A new language re-renders every text at once. After each
 * commit it records the language and digits for createTranslateNow (translate-now.ts), so the crash
 * fallback, which renders outside this provider, keeps them.
 */
export function I18nProvider(props: I18nProviderProps): React.JSX.Element {
  const { language, digits, onError, children } = props;
  useEffect(() => {
    recordShownLanguage({ language, digits });
  }, [language, digits]);
  return (
    <IntlProvider
      locale={localeTagFor(language, digits)}
      messages={messagesFor(language)}
      defaultLocale={SOURCE_LANGUAGE}
      onError={onError}
    >
      <LanguageContext value={language}>
        <TBridge onError={onError}>{children}</TBridge>
      </LanguageContext>
    </IntlProvider>
  );
}
