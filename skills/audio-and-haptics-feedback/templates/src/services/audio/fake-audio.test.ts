// src/services/audio/fake-audio.test.ts
import { DEFAULT_AUDIO_SETTINGS } from './audio-port';
import { createFakeAudio } from './fake-audio';

describe('createFakeAudio', () => {
  it('records every call in order, as the tests above the port read them', async () => {
    const audio = createFakeAudio();
    audio.load({
      complete: { category: 'sfx', recipe: [] },
      goal: { category: 'sfx', recipe: [] },
    });
    audio.play('complete');
    audio.play('goal', 160);
    audio.cancelPending();
    audio.applySettings(DEFAULT_AUDIO_SETTINGS);
    audio.startMusic('theme');
    audio.stopMusic();
    await audio.suspend();
    await audio.resume();
    await audio.dispose();

    expect(audio.loadedIds).toStrictEqual(['complete', 'goal']);
    expect(audio.calls).toStrictEqual([
      { kind: 'play', soundId: 'complete', delayMs: 0 },
      { kind: 'play', soundId: 'goal', delayMs: 160 },
      { kind: 'cancel-pending' },
      { kind: 'settings', settings: DEFAULT_AUDIO_SETTINGS },
      { kind: 'music', soundId: 'theme' },
      { kind: 'music', soundId: null },
      { kind: 'suspend' },
      { kind: 'resume' },
      { kind: 'dispose' },
    ]);
  });
});
