// src/services/feedback/ui-feedback.ts
// The app-wide UI moments: which UI sound and which pulse each one makes. Feature events use their
// own cue tables (src/features/<feature>/<feature>-feedback.ts); canvas animations use track cues.
import { playCue } from './play-cue';

import type { FeedbackCue, FeedbackPorts } from './play-cue';
import type { UI_SOUNDS } from '@/services/audio/synth/ui-sounds';

type UiCue = FeedbackCue & { readonly sound: keyof typeof UI_SOUNDS };

/**
 * The table is the app's: delete a moment it has no call site for (with its UI sound), add one it
 * needs. Buttons are silent by default: the platform's own press feedback is enough, and Android
 * already plays its system click when the user enabled touch sounds. To give every press a sound,
 * add a `tap` row with a `ui.tap` sound and render `<PressFeedbackProvider playsSound>` at the root,
 * which turns Android's system click off (audio-and-haptics-feedback, "Tap sounds are opt-in").
 */
export const UI_FEEDBACK = {
  /** A switch or a picker step: the one control that pulses. */
  toggle: { sound: 'ui.toggle', haptic: 'selection' },
  /** An action the user asked for succeeded (saved, sent, done). */
  success: { sound: 'ui.success', haptic: 'success' },
  /** An action the user asked for failed (the error message shows at the same time). */
  error: { sound: 'ui.error', haptic: 'error' },
} as const satisfies Readonly<Record<string, UiCue>>;

export type UiFeedbackKind = keyof typeof UI_FEEDBACK;

/** Plays one UI moment through the ports. */
export function playUiFeedback(ports: FeedbackPorts, kind: UiFeedbackKind): void {
  playCue(ports, UI_FEEDBACK[kind]);
}
