// src/features/settings/use-settings-model.ts (stand-in): a switch plays the toggle moment.
import { playUiFeedback } from '@/services/feedback/ui-feedback';

import type { FeedbackPorts } from '@/services/feedback/play-cue';

export function onSoundSwitchChanged(ports: FeedbackPorts): void {
  playUiFeedback(ports, 'toggle');
}
