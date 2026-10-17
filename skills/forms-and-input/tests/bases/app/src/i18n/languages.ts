// src/i18n/languages.ts
export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];
export const SOURCE_LANGUAGE = 'en' satisfies Language;
