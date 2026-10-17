// src/ui/feedback/feedback-copy.test.ts
import en from '@/i18n/catalogs/en.json';

import { FALLBACK_FAILURE_KEY, feedbackCopyOf } from './feedback-copy';

import type { MessageKey } from '@/i18n/messages';

/** A t() that answers with the English catalog, so the test reads the real words. */
const english = (key: MessageKey): string => en[key];

describe('feedbackCopyOf', () => {
  it('translates the shared words of the feedback layer', () => {
    expect(feedbackCopyOf(english)).toStrictEqual({
      dismissLabel: en['feedback.notice.dismiss'],
      undoLabel: en['feedback.undo'],
      offlineText: en['feedback.offline.none'],
      unvalidatedText: en['feedback.offline.unvalidated'],
      updatingText: en['feedback.updating'],
    });
  });

  it('keeps a catalog message for failures no table knows', () => {
    expect(en[FALLBACK_FAILURE_KEY]).not.toBe('');
  });
});
