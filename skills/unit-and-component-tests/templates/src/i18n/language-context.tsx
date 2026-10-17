// src/i18n/language-context.tsx
import { createContext, use } from 'react';

import { SOURCE_LANGUAGE } from './languages';

import type { Language } from './languages';

export const LanguageContext = createContext<Language>(SOURCE_LANGUAGE);

/** The language the app shows now (the saved choice, else the device's, else the source). */
export function useLanguage(): Language {
  return use(LanguageContext);
}
