// src/features/__FEATURE__/__FEATURE__-feedback.ts
import type { FeedbackCue } from '@/services/feedback/play-cue';

/**
 * The feature's cue table: what each event that deserves feedback sounds and feels like (most events
 * deserve none). Event names say what happened. The model hook plays a row with playCue when the
 * event happens; an event shown by a canvas animation plays from its track cue instead, never both.
 */
export const __FEATURE_FEEDBACK__ = {
  'task-completed': { sound: 'complete', haptic: 'light' },
  'goal-reached': { sound: 'goal', haptic: 'success' },
  'streak-extended': { sound: 'streak', haptic: 'medium' },
} as const satisfies Readonly<Record<string, FeedbackCue>>;

export type __FEATURE_PASCAL__FeedbackEvent = keyof typeof __FEATURE_FEEDBACK__;
