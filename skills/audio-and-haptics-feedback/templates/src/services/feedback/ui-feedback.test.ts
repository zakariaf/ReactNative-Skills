// src/services/feedback/ui-feedback.test.ts
import { createFakeAudio } from '@/services/audio/fake-audio';
import { UI_SOUNDS } from '@/services/audio/synth/ui-sounds';
import { createFakeHaptics } from '@/services/haptics/fake-haptics';

import { UI_FEEDBACK, playUiFeedback } from './ui-feedback';

import type { UiFeedbackKind } from './ui-feedback';

const KINDS = Object.keys(UI_FEEDBACK) as UiFeedbackKind[];

describe('playUiFeedback', () => {
  it.each(KINDS)('plays the sound and the pulse of the %s moment', (kind) => {
    const ports = { audio: createFakeAudio(), haptics: createFakeHaptics() };
    const cue: { readonly sound: string; readonly haptic?: string } = UI_FEEDBACK[kind];
    playUiFeedback(ports, kind);
    expect(ports.audio.calls).toStrictEqual([{ kind: 'play', soundId: cue.sound, delayMs: 0 }]);
    expect(ports.haptics.played).toStrictEqual(cue.haptic === undefined ? [] : [cue.haptic]);
  });

  it('pairs a switch with the selection pulse', () => {
    expect(UI_FEEDBACK.toggle).toStrictEqual({ sound: 'ui.toggle', haptic: 'selection' });
  });

  it('gives every UI sound exactly one moment', () => {
    const sounds = Object.values(UI_FEEDBACK).map((cue) => cue.sound);
    expect([...sounds].sort()).toStrictEqual(Object.keys(UI_SOUNDS).sort());
  });
});
