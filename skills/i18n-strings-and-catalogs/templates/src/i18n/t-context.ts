// src/i18n/t-context.ts
import { createContext, use } from 'react';

import type { TFunction } from './create-t';

export const TContext = createContext<TFunction | null>(null);

/** The only way screens and model hooks get t(). Throws outside <I18nProvider>. */
export function useT(): TFunction {
  const t = use(TContext);
  if (t === null) throw new Error('useT() must be used inside <I18nProvider>');
  return t;
}
