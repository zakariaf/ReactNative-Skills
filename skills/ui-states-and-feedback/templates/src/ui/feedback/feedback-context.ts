// src/ui/feedback/feedback-context.ts
// What the one feedback host hands to the app: two stable functions, never the changing notice or
// question, so a new notice re-renders the host and not every screen that can notify.
import { createContext } from 'react';

import type { ConfirmOutcome, ConfirmRequest } from './confirm';
import type { NoticeRequest } from './notice';

export type Feedback = {
  /** Shows a notice in place of the one on screen. */
  readonly notify: (request: NoticeRequest) => void;
  /** Asks a question; only 'confirmed' may run the action. */
  readonly confirm: (request: ConfirmRequest) => Promise<ConfirmOutcome>;
};

/** Null outside FeedbackProvider; read it through useFeedback(), which names the missing provider. */
export const FeedbackContext = createContext<Feedback | null>(null);

/** The host elements' testIDs: E2E flows find the notice dock and the dialog scrim by them. */
export const FEEDBACK_TEST_IDS = { notice: 'app.notice', confirm: 'app.confirm' } as const;
