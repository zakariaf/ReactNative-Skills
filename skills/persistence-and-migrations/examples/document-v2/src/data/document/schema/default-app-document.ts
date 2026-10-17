// src/data/document/schema/default-app-document.ts: the first-launch document, always in the latest shape.
import { LATEST_DOCUMENT_VERSION } from '@/data/document/schema/app-document';

import type { AppDocument, AppSettings } from '@/data/document/schema/app-document';

/** First-launch settings: follow the device for theme, language and motion. */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: null,
  reminderHour: 9,
  soundEnabled: true,
  reduceMotion: 'system',
  textScale: 100,
};

/** Empty statistics: a new user, and what "Reset statistics" writes. */
export const DEFAULT_STATS: AppDocument['stats'] = {
  tasksCompleted: 0,
  streak: { lastDate: null, length: 0 },
  bestStreak: 0,
  days: {},
};

export function createDefaultAppDocument(appId: string): AppDocument {
  return {
    schemaVersion: LATEST_DOCUMENT_VERSION,
    appId,
    settings: DEFAULT_SETTINGS,
    onboarding: { completed: false, seenTips: [] },
    stats: DEFAULT_STATS,
    premium: { owned: false, ownedSinceMs: null, lastCheckedAtMs: null, revokedAtMs: null },
  };
}
