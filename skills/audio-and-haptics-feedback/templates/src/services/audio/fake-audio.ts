// src/services/audio/fake-audio.ts
import type { AudioPort, AudioSettings, SoundBank } from './audio-port';

export type AudioCall =
  | { readonly kind: 'play'; readonly soundId: string; readonly delayMs: number }
  | { readonly kind: 'cancel-pending' }
  | { readonly kind: 'settings'; readonly settings: AudioSettings }
  | { readonly kind: 'music'; readonly soundId: string | null }
  | { readonly kind: 'suspend' | 'resume' | 'dispose' };

export type FakeAudio = AudioPort & {
  readonly calls: AudioCall[];
  readonly loadedIds: string[];
};

/** In-memory AudioPort for tests: records every call in order. */
export function createFakeAudio(): FakeAudio {
  const calls: AudioCall[] = [];
  const loadedIds: string[] = [];
  const record = (call: AudioCall): Promise<void> => {
    calls.push(call);
    return Promise.resolve();
  };
  return {
    calls,
    loadedIds,
    load: (bank: SoundBank) => loadedIds.push(...Object.keys(bank)),
    play: (soundId, delayMs = 0) => calls.push({ kind: 'play', soundId, delayMs }),
    cancelPending: () => calls.push({ kind: 'cancel-pending' }),
    applySettings: (settings) => calls.push({ kind: 'settings', settings }),
    startMusic: (soundId) => calls.push({ kind: 'music', soundId }),
    stopMusic: () => calls.push({ kind: 'music', soundId: null }),
    suspend: () => record({ kind: 'suspend' }),
    resume: () => record({ kind: 'resume' }),
    dispose: () => record({ kind: 'dispose' }),
  };
}
