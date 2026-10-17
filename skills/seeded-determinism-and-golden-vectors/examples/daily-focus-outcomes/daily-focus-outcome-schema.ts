// src/data/daily-focus/daily-focus-outcome-schema.ts (example: the stored row and its mapping)
// The SQL table (persistence-and-migrations owns the migration that creates it):
//   CREATE TABLE daily_focus_outcomes (
//     date_key TEXT PRIMARY KEY,               -- the civil date, 'YYYY-MM-DD'
//     generator_version INTEGER NOT NULL,      -- the version that made what the user saw
//     completed_ids TEXT NOT NULL              -- JSON array of the ids the user completed
//   ) STRICT;
// Only row mapping lives here; regenerating what the user saw is feature code
// (src/features/daily-focus/daily-focus-replay.ts).
import * as v from 'valibot';

import { isDateKey } from '@/core/dates/date-key';

import type { FocusOutcome } from './daily-focus-outcome-repository';

/** What `SELECT date_key, generator_version, completed_ids FROM daily_focus_outcomes` returns. */
export const FOCUS_OUTCOME_ROW = v.strictObject({
  date_key: v.pipe(v.string(), v.check(isDateKey, 'not a civil date')),
  generator_version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  completed_ids: v.string(),
});

const COMPLETED_IDS = v.array(v.string());

export type FocusOutcomeRow = v.InferOutput<typeof FOCUS_OUTCOME_ROW>;

/** The row written for an outcome. */
export function toOutcomeRow(outcome: FocusOutcome): FocusOutcomeRow {
  return {
    date_key: outcome.dateKey,
    generator_version: outcome.generatorVersion,
    completed_ids: JSON.stringify(outcome.completedIds),
  };
}

/** A stored row back to an outcome; throws on a row the app never wrote. */
export function fromOutcomeRow(row: unknown): FocusOutcome {
  const parsed = v.parse(FOCUS_OUTCOME_ROW, row);
  return {
    dateKey: parsed.date_key,
    generatorVersion: parsed.generator_version,
    completedIds: v.parse(COMPLETED_IDS, JSON.parse(parsed.completed_ids)),
  };
}
