// src/i18n/messages.ts
import ar from './catalogs/ar.json';
import en from './catalogs/en.json';

import type { Language } from './languages';

/** One language's messages: a flat map of key to ICU message. */
export type Catalog = Readonly<Record<string, string>>;

/** Every key of the source catalog, so a misspelt key is a type error at the call site. */
export type MessageKey = keyof typeof en;

const CATALOGS: Readonly<Record<Language, Catalog>> = { en, ar };

/**
 * The messages IntlProvider gets for a language. There is no merge with the source catalog: a key
 * missing in a translation reaches onError (the error log in the app, a thrown error in tests)
 * instead of silently showing English.
 */
export function messagesFor(language: Language): Catalog {
  return CATALOGS[language];
}
