// src/features/settings/use-language-choice.ts
// A language change saves first, then restarts through the direction module when the direction differs.
import { readLayoutDirection, restartForDirection } from '@/i18n/direction';
import { directionOf } from '@/i18n/languages';

import type { Language } from '@/i18n/languages';
import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';

export async function applyLanguageChoice(
  next: Language,
  save: (language: Language) => void,
  guard: DirectionGuardPort,
): Promise<void> {
  save(next);
  if (directionOf(next) !== readLayoutDirection()) await restartForDirection(directionOf(next), guard);
}
