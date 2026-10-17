// src/data/document/reset-document.ts: the document's user-facing resets. Each one lists exactly what it clears.
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';

import type { AppDocument } from '@/data/document/schema/app-document';

/**
 * "Reset all progress": every section the person's use of the app built up. In this document that
 * is the statistics; an app with more progress (levels, daily results) clears those here too.
 * KEPT: settings (theme, language, reminders), onboarding (first-run state survives a reset by
 * default: the person knows the app already) and premium, which no reset ever writes. A product
 * that wants the tour again adds `onboarding: fresh.onboarding` and says so in the confirmation.
 * Written with refreshBackup: true, so restoring the backup can never undo the reset.
 */
export function resetAllProgress(doc: AppDocument): AppDocument {
  const fresh = createDefaultAppDocument(doc.appId);
  return { ...doc, stats: fresh.stats };
}

/** "Reset statistics": the stats section only. */
export function resetStatistics(doc: AppDocument): AppDocument {
  return { ...doc, stats: createDefaultAppDocument(doc.appId).stats };
}
