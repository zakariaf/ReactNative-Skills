// src/i18n/use-locale-tag.ts
// The locale tag the app formats with now (language plus digits: 'en', 'ar-u-nu-arab'), read from
// the IntlProvider that I18nProvider renders. Model hooks pass it to formatMoney, formatQuantity and
// normalizeDecimalInput, so an amount, a quantity and the text field around them agree on digits.
import { useIntl } from 'react-intl';

/** 'en', 'ar-u-nu-arab', 'ar-u-nu-latn': the tag localeTagFor(language, digits) gave the provider. */
export function useLocaleTag(): string {
  return useIntl().locale;
}
