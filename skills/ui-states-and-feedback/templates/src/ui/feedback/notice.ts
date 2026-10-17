// src/ui/feedback/notice.ts
// A notice is the low rung of the feedback ladder: a short line about something that just
// happened ("Task deleted"), with at most one action (Undo). One notice is on screen at a time; a
// newer one replaces it instead of queueing behind it, because a queue shows old news late.
// Anything the person must act on later is not a notice: it stays inline or in a banner.
import { NOTICE_TIMING } from './feedback-timing';

import type { NoticeTiming } from './feedback-timing';

export type NoticeAction = {
  /** Translated verb: "Undo". */
  readonly label: string;
  readonly onPress: () => void;
};

/** What a model hook asks to show. */
export type NoticeRequest = {
  /** Translated, one short sentence: "Task deleted". */
  readonly text: string;
  readonly action?: NoticeAction;
  /** '<screen>.<what>-notice'; the action derives '.action'. */
  readonly testID: string;
};

/** A notice on screen: the request plus the serial that tells two equal texts apart. */
export type Notice = NoticeRequest & { readonly serial: number };

export type NoticeState = { readonly current: Notice | null };

export type NoticeEvent =
  | { readonly type: 'notice-shown'; readonly notice: Notice }
  | { readonly type: 'notice-closed'; readonly serial: number };

export const INITIAL_NOTICE_STATE: NoticeState = { current: null };

/** Showing replaces; closing closes only the notice it names (a late timer never closes a newer one). */
export function noticeReducer(state: NoticeState, event: NoticeEvent): NoticeState {
  switch (event.type) {
    case 'notice-shown':
      return { current: event.notice };
    case 'notice-closed':
      return state.current?.serial === event.serial ? INITIAL_NOTICE_STATE : state;
  }
}

/**
 * How long a notice stays before it leaves by itself, or null when it stays until dismissed: a
 * notice with an action while a screen reader runs, because the person may not reach the button
 * in time (WCAG 2.2.1). The result is a floor for getRecommendedTimeoutMillis.
 */
export function noticeLifetimeMs(
  notice: NoticeRequest,
  isScreenReaderOn: boolean,
  timing: NoticeTiming = NOTICE_TIMING,
): number | null {
  if (notice.action === undefined) return timing.resultMs;
  return isScreenReaderOn ? null : timing.actionMs;
}
