// src/i18n/languages.ts
export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['ar']);

export function directionOf(language: Language): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}
