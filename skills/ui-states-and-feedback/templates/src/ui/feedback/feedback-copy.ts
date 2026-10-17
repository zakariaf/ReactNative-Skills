// src/ui/feedback/feedback-copy.ts
// The app-wide words of the feedback layer, translated once where the FeedbackProvider and the
// offline banner are mounted (the root stack's model). Screens add their own copy; these are the
// words every screen shares.
import type { TFunction } from '@/i18n/create-t';
import type { MessageKey } from '@/i18n/messages';

export type FeedbackCopy = {
  /** "Dismiss": closes a notice that stays until dismissed. */
  readonly dismissLabel: string;
  /** "Undo": the one action of a notice after a reversible change. */
  readonly undoLabel: string;
  /** The offline banner when there is no network at all. */
  readonly offlineText: string;
  /** The softer banner when Android has not validated the network (requests may still work). */
  readonly unvalidatedText: string;
  /** "Updating…": the quiet line above a list while a background refetch runs. */
  readonly updatingText: string;
};

/**
 * The message for a failure no failure table knows (a bug, or a kind added without its message).
 * Never the default for a known kind: each kind has its own message (error-handling-typed-results).
 */
export const FALLBACK_FAILURE_KEY = 'feedback.failure.unknown' satisfies MessageKey;

export function feedbackCopyOf(t: TFunction): FeedbackCopy {
  return {
    dismissLabel: t('feedback.notice.dismiss'),
    undoLabel: t('feedback.undo'),
    offlineText: t('feedback.offline.none'),
    unvalidatedText: t('feedback.offline.unvalidated'),
    updatingText: t('feedback.updating'),
  };
}
