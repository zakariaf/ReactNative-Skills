// src/ui/feedback/feedback-timing.ts
// The behavioural thresholds of the app's non-happy paths, in one place. They are not design
// tokens (no colour, size or animation curve): each is a perception limit with its reason, and the
// screens and the notice host read them from here, never a literal of their own.

/** When a loading placeholder may appear, and how long it stays once it did. */
export type PlaceholderTiming = {
  /** A load that ends sooner shows nothing at all: a flash is worse than a short blank. */
  readonly showDelayMs: number;
  /** Once shown, the placeholder stays at least this long, so it never blinks on and off. */
  readonly minVisibleMs: number;
};

/** How long a notice stays on screen before it leaves by itself. */
export type NoticeTiming = {
  /** A notice that only reports a result ("Task saved"). */
  readonly resultMs: number;
  /** A notice that holds an action (Undo): long enough to read it and reach the button. */
  readonly actionMs: number;
};

/**
 * Below 300 ms a load reads as instant and a placeholder only as a flicker, so nothing shows until
 * then. 500 ms is the shortest a placeholder can be on screen and still read as a deliberate state
 * (React keeps a shown Suspense fallback up for about 300 ms for the same reason; it never delays
 * showing one, so a Suspense fallback needs this delay too).
 */
export const PLACEHOLDER_TIMING: PlaceholderTiming = { showDelayMs: 300, minVisibleMs: 500 };

/**
 * 4 s reads a short sentence twice; 8 s more leaves time to move a thumb to the action. Both are a
 * floor: the notice host passes them through AccessibilityInfo.getRecommendedTimeoutMillis, which
 * returns the person's "Time to take action" setting on Android (iOS returns the value unchanged),
 * and a notice with an action stays until dismissed while a screen reader runs.
 */
export const NOTICE_TIMING: NoticeTiming = { resultMs: 4000, actionMs: 8000 };
