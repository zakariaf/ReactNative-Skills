// src/features/tasks/use-task-counts.ts
// Numbers outside messages: formatted with the same locale tag as the catalogs.
import { createNumberFormatter } from '@/i18n/create-number-formatter';
import { localeTagFor } from '@/i18n/digits';

import type { DigitStyle } from '@/i18n/digits';
import type { Language } from '@/i18n/languages';

export function taskCountText(count: number, language: Language, digits: DigitStyle): string {
  return createNumberFormatter(localeTagFor(language, digits))(count);
}
