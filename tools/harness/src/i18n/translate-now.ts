// src/i18n/translate-now.ts
// t() without React context, for the few texts shown outside I18nProvider: the root crash fallback
// (Expo Router's boundary replaces the root layout and every provider it mounts) and a startup
// failure screen. The language is the one I18nProvider showed last (it records its language and
// digits after every commit), so a crash keeps the person's own language and digits; before any
// provider has committed, it follows the device's languages, then the source language. Built from
// the same pieces as useT() (react-intl's createIntl, the catalogs, createT), so it formats exactly
// alike. It sits in src/i18n/ because only this folder imports react-intl.
import { getLocales } from 'expo-localization';
import { createIntl } from 'react-intl';

import { createT } from './create-t';
import { localeTagFor } from './digits';
import { SOURCE_LANGUAGE } from './languages';
import { messagesFor } from './messages';
import { resolveLanguage } from './resolve-language';

import type { TFunction } from './create-t';
import type { DigitStyle } from './digits';
import type { Language } from './languages';

/** The language and digits the app shows. */
export type ShownLanguage = {
  readonly language: Language;
  readonly digits: DigitStyle;
};

let lastShown: ShownLanguage | null = null;

/**
 * Called by I18nProvider after each commit (nothing else writes it); null forgets it (tests). The
 * value outlives the provider on purpose: the crash fallback renders after the layout that mounted
 * the provider is gone.
 */
export function recordShownLanguage(shown: ShownLanguage | null): void {
  lastShown = shown;
}

/** The language and digits shown now: the last ones I18nProvider showed, else the device's. */
export function languageNow(): ShownLanguage {
  return lastShown ?? { language: resolveLanguage(null, getLocales()), digits: 'automatic' };
}

/**
 * A t() for the language shown now, read when it is called (build it in the render that needs it).
 * It never throws by itself: a missing message or a number passed to a text placeholder goes to
 * `onError` (the error log; never a throw in a crash fallback, where nothing catches it) and a
 * missing message renders its key.
 */
export function createTranslateNow(onError: (error: Error) => void): TFunction {
  const { language, digits } = languageNow();
  const intl = createIntl({
    locale: localeTagFor(language, digits),
    messages: messagesFor(language),
    defaultLocale: SOURCE_LANGUAGE,
    onError,
  });
  return createT({ intl, onError });
}
