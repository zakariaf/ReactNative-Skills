// src/i18n/language-context.tsx: a context file may export its own hook.
import { createContext, use } from 'react';

const LanguageContext = createContext('en');

export const LanguageProvider = LanguageContext;

export function useLanguage(): string {
  return use(LanguageContext);
}
