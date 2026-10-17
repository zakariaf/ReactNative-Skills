// src/i18n/languages.ts (fixture: four languages, so the rules meet two scripts and three plural systems)
export const LANGUAGES = ['en', 'de', 'fa', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];
export const SOURCE_LANGUAGE = 'en' satisfies Language;
