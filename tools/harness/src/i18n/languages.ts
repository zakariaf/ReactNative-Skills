// src/i18n/languages.ts
// The app's languages: the one list the catalogs, the Intl polyfill data, the locale tags and the
// i18n checkers follow. Adding a language means: add it here, add src/i18n/catalogs/<code>.json,
// its two locale-data imports in intl-polyfills.ts, its row in digits.ts, and (for a
// right-to-left script) RTL_LANGUAGES. The checkers fail until all of them agree.
export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];
export type Direction = 'ltr' | 'rtl';

/** The language every key is written in first; the other catalogs translate it. */
export const SOURCE_LANGUAGE = 'en' satisfies Language;

const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['ar']);

/**
 * Each language's name in its own language and script, for the language picker. Code, never
 * catalog text: translators must not change them, and a test pins them.
 */
export const LANGUAGE_AUTONYMS: Readonly<Record<Language, string>> = {
  en: 'English',
  ar: 'العربية',
};

export function directionOf(language: Language): Direction {
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
