// src/theme/use-text-locale.ts
import { use } from 'react';

import { TextLocaleContext } from './text-locale';

import type { TextLocale } from './text-locale';

/**
 * The UI language and its text direction (directionOf(language)) the i18n root provides
 * (DEFAULT_TEXT_LOCALE without one).
 */
export function useTextLocale(): TextLocale {
  return use(TextLocaleContext);
}
