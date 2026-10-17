// src/features/root-navigator/game-feedback.ts
// The games root's cue table (audio-and-haptics-feedback): what a run's result sounds and feels
// like. The host calls GameHostDeps.feedback once, from the change that decided the run, after its
// end is on disk; games-root.tsx beside it plays the row with playCue (a table in the Game feature
// would be a feature-to-feature import). The app's sound bank must hold
// 'ui.win' and 'ui.lose' (audio-and-haptics-feedback's sound bank).
import type { FeedbackCue } from '@/services/feedback/play-cue';

export const GAME_FEEDBACK = {
  win: { sound: 'ui.win', haptic: 'success' },
  lose: { sound: 'ui.lose', haptic: 'error' },
} as const satisfies Readonly<Record<'win' | 'lose', FeedbackCue>>;
