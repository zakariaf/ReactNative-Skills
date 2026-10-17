// src/services/audio/admit-voice.ts
import type { ChannelSetting } from './audio-port';

export const MAX_VOICES = 8;
export const DEFAULT_MIN_INTERVAL_MS = 30;
/** Ended voices are kept this long for the repeat rule (every minIntervalMs must stay below it). */
export const REMEMBER_MS = 1000;

/** One admitted voice on the audio clock (ms): sounding now or scheduled for later. */
export type Voice = {
  readonly soundId: string;
  readonly startMs: number;
  readonly untilMs: number;
};

export type VoiceState = { readonly voices: readonly Voice[] };

export const EMPTY_VOICES: VoiceState = { voices: [] };

export type VoiceRequest = {
  readonly soundId: string;
  /** When the voice would start on the audio clock (now + the cue's delay). */
  readonly atMs: number;
  readonly durationMs: number;
  readonly minIntervalMs: number;
  /** The audio clock now: voices that ended long before it are forgotten. */
  readonly nowMs: number;
};

export type VoiceDecision = {
  readonly isAdmitted: boolean;
  readonly state: VoiceState;
  /** The voice the request describes (kept in state only when admitted). */
  readonly voice: Voice;
};

/**
 * Pure: decides whether a voice may start, and the next state. Time is the audio clock. Voices are
 * intervals, so cues scheduled out of order and voices still waiting to start are judged correctly.
 */
export function admitVoice(state: VoiceState, request: VoiceRequest): VoiceDecision {
  const voice: Voice = {
    soundId: request.soundId,
    startMs: request.atMs,
    untilMs: request.atMs + request.durationMs,
  };
  const kept = state.voices.filter(
    (other) => other.untilMs > request.nowMs || request.nowMs - other.startMs < REMEMBER_MS,
  );
  const overlapping = kept.filter(
    (other) => other.startMs < voice.untilMs && other.untilMs > voice.startMs,
  ).length;
  const isTooSoon = kept.some(
    (other) =>
      other.soundId === request.soundId &&
      Math.abs(other.startMs - request.atMs) < request.minIntervalMs,
  );
  if (isTooSoon || overlapping >= MAX_VOICES) {
    return { isAdmitted: false, state: { voices: kept }, voice };
  }
  return { isAdmitted: true, state: { voices: [...kept, voice] }, voice };
}

/** Pure: forgets voices that were cancelled before they sounded (cancelPending). */
export function releaseVoices(state: VoiceState, released: readonly Voice[]): VoiceState {
  return { voices: state.voices.filter((voice) => !released.includes(voice)) };
}

/** Settings → gain. Squared for a perceptually even slider; 0 when the channel is off. */
export function channelGain(setting: ChannelSetting): number {
  return setting.isOn ? setting.volume * setting.volume : 0;
}
