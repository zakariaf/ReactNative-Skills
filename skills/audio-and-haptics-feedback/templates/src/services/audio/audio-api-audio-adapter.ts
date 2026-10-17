// src/services/audio/audio-api-audio-adapter.ts
// The only file that imports react-native-audio-api (pinned exactly; verified on 0.13.6).
import { Platform } from 'react-native';
import { AudioContext, AudioManager } from 'react-native-audio-api';

import { synthesizeRecipe } from '@/services/audio/synth/synthesize-recipe';

import {
  DEFAULT_MIN_INTERVAL_MS,
  EMPTY_VOICES,
  admitVoice,
  channelGain,
  releaseVoices,
} from './admit-voice';

import type { Voice } from './admit-voice';
import type { AudioPort, AudioSettings, SoundBank, SoundCategory, SoundSpec } from './audio-port';
import type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioEventSubscription,
  GainNode,
} from 'react-native-audio-api';

type Loaded = {
  readonly buffer: AudioBuffer;
  readonly spec: SoundSpec;
  readonly durationMs: number;
};
/** A voice scheduled for later: stopped and released again if its cue is cancelled. */
type Pending = { readonly source: AudioBufferSourceNode; readonly voice: Voice };
type Graph = {
  readonly ctx: AudioContext;
  readonly gains: Readonly<Record<SoundCategory, GainNode>>;
};

const RAMP_S = 0.05;

/**
 * One AudioContext per app. iOS: the ambient session respects the silent switch and mixes with the
 * user's music, and it must be set before the context exists (the call does nothing on Android).
 */
function createGraph(): Graph {
  AudioManager.setAudioSessionOptions({
    iosCategory: 'ambient',
    iosMode: 'default',
    iosOptions: [],
  });
  const ctx = new AudioContext();
  const gains = { sfx: ctx.createGain(), ui: ctx.createGain(), music: ctx.createGain() };
  for (const gain of Object.values(gains)) gain.connect(ctx.destination);
  return { ctx, gains };
}

/** Click-free gain change: hold the current value, then ramp linearly for 50 ms. */
function rampTo(ctx: AudioContext, gain: GainNode, value: number): void {
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + RAMP_S);
}

export type AudioAdapterDeps = {
  /** `(error) => { errorLog.record('service', error); }`: logged, never thrown into the UI. */
  readonly reportError: (error: unknown) => void;
};

class AudioApiAudioAdapter implements AudioPort {
  private readonly reportError: (error: unknown) => void;
  private graph: Graph | null = null;
  private readonly loaded = new Map<string, Loaded>();
  private voices = EMPTY_VOICES;
  private pending: Pending[] = [];
  private music: AudioBufferSourceNode | null = null;
  private interruptions: AudioEventSubscription | null = null;
  /**
   * What the lifecycle last asked for (suspend or resume). An iOS interruption that ends resumes the
   * context only when it is true: a call that ends during a full-screen video stays silent.
   */
  private wantsRunning = true;

  constructor(deps: AudioAdapterDeps) {
    this.reportError = deps.reportError;
  }

  readonly load = (bank: SoundBank): void => {
    const graph = this.ensureGraph();
    for (const [id, spec] of Object.entries(bank)) {
      const samples = synthesizeRecipe(spec.recipe, graph.ctx.sampleRate);
      const buffer = graph.ctx.createBuffer(1, samples.length, graph.ctx.sampleRate);
      buffer.copyToChannel(samples, 0, 0);
      const durationMs = (samples.length / graph.ctx.sampleRate) * 1000;
      this.loaded.set(id, { buffer, spec, durationMs });
    }
  };

  readonly play = (soundId: string, delayMs = 0): void => {
    const item = this.loaded.get(soundId);
    if (item === undefined || this.graph === null) return;
    const nowS = this.graph.ctx.currentTime;
    const startS = nowS + delayMs / 1000;
    const decision = admitVoice(this.voices, {
      soundId,
      atMs: startS * 1000,
      durationMs: item.durationMs,
      minIntervalMs: item.spec.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
      nowMs: nowS * 1000,
    });
    this.voices = decision.state;
    this.pending = this.pending.filter((entry) => entry.voice.startMs > nowS * 1000);
    if (!decision.isAdmitted) return;
    const source = this.graph.ctx.createBufferSource();
    source.buffer = item.buffer;
    source.connect(this.graph.gains[item.spec.category]);
    source.start(startS);
    if (delayMs > 0) this.pending.push({ source, voice: decision.voice });
  };

  readonly cancelPending = (): void => {
    const nowMs = (this.graph?.ctx.currentTime ?? 0) * 1000;
    const future = this.pending.filter((entry) => entry.voice.startMs > nowMs);
    for (const { source } of future) source.stop(0);
    // A cancelled voice never sounds: free its slot and its repeat window for the next action.
    this.voices = releaseVoices(
      this.voices,
      future.map((entry) => entry.voice),
    );
    this.pending = [];
  };

  readonly applySettings = (settings: AudioSettings): void => {
    const graph = this.graph;
    if (graph === null) return;
    rampTo(graph.ctx, graph.gains.sfx, channelGain(settings.effects));
    rampTo(graph.ctx, graph.gains.ui, channelGain(settings.effects));
    rampTo(graph.ctx, graph.gains.music, channelGain(settings.music));
  };

  readonly startMusic = (soundId: string): void => {
    const item = this.loaded.get(soundId);
    if (item === undefined || this.graph === null || this.music !== null) return;
    const source = this.graph.ctx.createBufferSource();
    source.buffer = item.buffer;
    source.loop = true;
    source.connect(this.graph.gains.music);
    source.start(this.graph.ctx.currentTime);
    this.music = source;
  };

  readonly stopMusic = (): void => {
    this.music?.stop(0);
    this.music = null;
  };

  readonly suspend = async (): Promise<void> => {
    this.wantsRunning = false;
    await this.suspendContext();
  };

  readonly resume = async (): Promise<void> => {
    this.wantsRunning = true;
    await this.resumeContext();
  };

  readonly dispose = async (): Promise<void> => {
    this.interruptions?.remove();
    this.stopMusic();
    try {
      await this.graph?.ctx.close();
    } catch (error) {
      this.reportError(error);
    }
    this.graph = null;
  };

  private async suspendContext(): Promise<void> {
    this.cancelPending();
    try {
      await this.graph?.ctx.suspend();
    } catch (error) {
      this.reportError(error);
    }
  }

  private async resumeContext(): Promise<void> {
    try {
      await this.graph?.ctx.resume();
    } catch (error) {
      this.reportError(error);
    }
  }

  private ensureGraph(): Graph {
    if (this.graph !== null) return this.graph;
    this.graph = createGraph();
    // iOS: even an ambient session is interrupted by calls and Siri: observe it to suspend, resume.
    // Android: observing requests AUDIOFOCUS_GAIN, which fades out and mutes the user's music
    // (Android 12+). Feedback plays without focus and mixes, the same as iOS's ambient category.
    if (Platform.OS === 'ios') AudioManager.observeAudioInterruptions(true);
    // An interruption never changes what the lifecycle asked for: when it ends, the context resumes
    // only if iOS says shouldResume and the lifecycle still wants it running (not during a video).
    this.interruptions = AudioManager.addSystemEventListener('interruption', (event) => {
      if (event.type === 'began') {
        this.suspendContext().catch(this.reportError);
      } else if (event.shouldResume && this.wantsRunning) {
        this.resumeContext().catch(this.reportError);
      }
    });
    return this.graph;
  }
}

/** Create exactly one per app, in the composition root (one AudioContext per app). */
export function createAudioApiAudioAdapter(deps: AudioAdapterDeps): AudioPort {
  return new AudioApiAudioAdapter(deps);
}
