// src/i18n/languages.ts
export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language every key is written in first; the other catalogs translate it. */
export const SOURCE_LANGUAGE = 'en' satisfies Language;
