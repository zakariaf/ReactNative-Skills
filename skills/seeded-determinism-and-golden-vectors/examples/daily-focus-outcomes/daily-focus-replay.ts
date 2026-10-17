// src/features/daily-focus/daily-focus-replay.ts (example: regenerate what the user saw)
// Pure feature logic between the generator and the stored outcome. The model hook
// (use-daily-focus-model.ts) reads today from the clock port and the outcome from the repository,
// and calls these; nothing here reads a clock, a store or the database.
import { generateDailyFocus } from './daily-focus-generator';

import type { DailyFocus } from './daily-focus-generator';
import type { DateKey } from '@/core/dates/date-key';
import type { FocusOutcome } from '@/data/daily-focus/daily-focus-outcome-repository';

/** What the user saw that day: regenerated with the version stored next to the outcome. */
export function focusForOutcome(outcome: FocusOutcome): DailyFocus {
  return generateDailyFocus(outcome.dateKey, outcome.generatorVersion);
}

/** A new outcome for today stamps the version the generator used, never "the latest". */
export function startOutcome(today: DateKey): FocusOutcome {
  const focus = generateDailyFocus(today);
  return { dateKey: today, generatorVersion: focus.version, completedIds: [] };
}
