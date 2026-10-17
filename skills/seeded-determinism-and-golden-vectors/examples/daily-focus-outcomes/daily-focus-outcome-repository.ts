// src/data/daily-focus/daily-focus-outcome-repository.ts (example: regenerate, never store)
// The daily-focus outcome repository port. What the Tasks app stores about a day's focus is the key,
// the generator version that ran and what the user did. The suggested tasks themselves are never
// stored: features regenerate them from (key, version), so there is one source of truth and a later
// generator version can never rewrite a past day. contracts/seeded-generators.json names this file
// as the generator's "outcome" ("versionField": "generatorVersion").
import type { DateKey } from '@/core/dates/date-key';

/** One stored outcome: never the generated content itself. */
export type FocusOutcome = {
  readonly dateKey: DateKey;
  /** The version that made what the user saw: `output.version`, never "the latest". */
  readonly generatorVersion: number;
  readonly completedIds: readonly string[];
};

/**
 * Synchronous, like every repository in src/data/. Adapters: sqlite-daily-focus-outcome-repository.ts
 * (the app) and fake-daily-focus-outcome-repository.ts (tests); persistence-and-migrations owns both
 * shapes, the table and its migration.
 */
export type DailyFocusOutcomeRepository = {
  readonly outcomeFor: (dateKey: DateKey) => FocusOutcome | null;
  readonly save: (outcome: FocusOutcome) => void;
};
