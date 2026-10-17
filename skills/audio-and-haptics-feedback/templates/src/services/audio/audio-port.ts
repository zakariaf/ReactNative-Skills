// src/services/audio/audio-port.ts
import type { SoundRecipe } from '@/services/audio/synth/synthesize-recipe';

/** sfx: feature and game sounds · ui: the app-wide UI sounds · music: one optional loop. */
export type SoundCategory = 'sfx' | 'ui' | 'music';

export type SoundSpec = {
  readonly category: SoundCategory;
  readonly recipe: SoundRecipe;
  /** The same sound cannot restart sooner than this (default 30 ms, at most 1000 ms). */
  readonly minIntervalMs?: number;
  /** Music only: loop the buffer. */
  readonly isLoop?: boolean;
};

/** Sound id (a kebab-case noun, or ui.<kebab> for the UI sounds) to its spec. */
export type SoundBank = Readonly<Record<string, SoundSpec>>;

export type ChannelSetting = { readonly isOn: boolean; readonly volume: number };

/**
 * The user's sound settings, volumes 0…1 (the settings store keeps them; its glue calls
 * applySettings). Music defaults to off: the app never plays over the user's own music unless asked.
 */
export type AudioSettings = { readonly effects: ChannelSetting; readonly music: ChannelSetting };

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  effects: { isOn: true, volume: 0.8 },
  music: { isOn: false, volume: 0.6 },
};

/** The only audio API the app uses. Adapter: audio-api-audio-adapter.ts. Fake: fake-audio.ts. */
export type AudioPort = {
  /** Synthesises and uploads every buffer of the bank (once, at startup). */
  readonly load: (bank: SoundBank) => void;
  /** Plays a sound now, or `delayMs` later on the audio clock (track cues). Ignores unknown ids. */
  readonly play: (soundId: string, delayMs?: number) => void;
  /** Stops sounds scheduled for the future (fast-forward, pause, leaving the screen). */
  readonly cancelPending: () => void;
  readonly applySettings: (settings: AudioSettings) => void;
  readonly startMusic: (soundId: string) => void;
  readonly stopMusic: () => void;
  /** Never rejects: the adapter records a failure through its reportError. */
  readonly suspend: () => Promise<void>;
  readonly resume: () => Promise<void>;
  /** Closes the engine: before any JS reload, and in tests. Never rejects. */
  readonly dispose: () => Promise<void>;
};
