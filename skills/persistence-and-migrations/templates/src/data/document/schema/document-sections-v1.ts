// src/data/document/schema/document-sections-v1.ts: every section of document version 1. Frozen once shipped.
import * as v from 'valibot';

import {
  COUNT,
  DATE_KEY,
  HOUR,
  KEBAB_ID,
  LANGUAGE_TAG,
} from '@/data/document/schema/document-primitives';

export const SETTINGS_V1 = v.strictObject({
  theme: v.picklist(['system', 'light', 'dark']),
  language: v.nullable(LANGUAGE_TAG),
  reminderHour: HOUR,
  soundEnabled: v.boolean(),
  reduceMotion: v.picklist(['system', 'on', 'off']),
});

export const ONBOARDING_V1 = v.strictObject({
  completed: v.boolean(),
  /** Tips already shown, in the order they were shown. */
  seenTips: v.array(KEBAB_ID),
});

export const STATS_V1 = v.strictObject({
  tasksCompleted: COUNT,
  streak: v.strictObject({ lastDate: v.nullable(DATE_KEY), length: COUNT }),
  bestStreak: COUNT,
  /** Completions per local day, pruned to the last 30 days (the counts above are all-time). */
  days: v.record(DATE_KEY, COUNT),
});

/** The entitlement. Protected: no reset writes it, and only a dated revocation turns it off. */
export const PREMIUM_V1 = v.strictObject({
  owned: v.boolean(),
  ownedSinceMs: v.nullable(COUNT),
  lastCheckedAtMs: v.nullable(COUNT),
  revokedAtMs: v.nullable(COUNT),
});
