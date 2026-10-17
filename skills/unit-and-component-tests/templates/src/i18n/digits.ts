// src/i18n/digits.ts
import type { Language } from './languages';

/** The digits setting: the language's default, always Latin, or always the language's own. */
export type DigitStyle = 'automatic' | 'latin' | 'local';

/**
 * The CLDR numbering system each language uses for `automatic` and for `local`. An explicit table,
 * because CLDR defaults move between releases (CLDR 48 switched `ar` to Latin digits) and Hermes
 * ignores a tag's -u-nu- part unless the forced FormatJS polyfills run (intl-polyfills.ts).
 */
const NUMBERING: Readonly<Record<Language, Readonly<{ automatic: string; local: string }>>> = {
  en: { automatic: 'latn', local: 'latn' },
  ar: { automatic: 'arab', local: 'arab' },
};

/**
 * The BCP 47 tag handed to IntlProvider and to every Intl.NumberFormat, so messages and
 * stand-alone numbers show the same digits: 'en', 'ar-u-nu-arab', 'ar-u-nu-latn'.
 */
export function localeTagFor(language: Language, digits: DigitStyle): string {
  const row = NUMBERING[language];
  const system = digits === 'latin' ? 'latn' : row[digits];
  return system === 'latn' && row.local === 'latn' ? language : `${language}-u-nu-${system}`;
}
