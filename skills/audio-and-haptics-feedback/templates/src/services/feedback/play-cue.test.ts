// src/services/feedback/play-cue.test.ts
import { createFakeAudio } from '@/services/audio/fake-audio';
import { createFakeHaptics } from '@/services/haptics/fake-haptics';

import { playCue } from './play-cue';

describe('playCue', () => {
  it('plays the sound and the pulse of a cue', () => {
    const ports = { audio: createFakeAudio(), haptics: createFakeHaptics() };
    playCue(ports, { sound: 'complete', haptic: 'success' });
    expect(ports.audio.calls).toStrictEqual([{ kind: 'play', soundId: 'complete', delayMs: 0 }]);
    expect(ports.haptics.played).toStrictEqual(['success']);
  });

  it('plays only the part a cue has', () => {
    const ports = { audio: createFakeAudio(), haptics: createFakeHaptics() };
    playCue(ports, { haptic: 'selection' });
    playCue(ports, { sound: 'delete' });
    expect(ports.audio.calls).toStrictEqual([{ kind: 'play', soundId: 'delete', delayMs: 0 }]);
    expect(ports.haptics.played).toStrictEqual(['selection']);
  });
});
