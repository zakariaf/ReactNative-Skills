// src/services/audio/synth/recipe-problems.ts
// The recipe quality gate, shared by the UI-sound test and every feature's sound-bank test.
import { synthesizeRecipe } from './synthesize-recipe';

import type { SoundRecipe, VoiceSpec } from './synthesize-recipe';

/** Tests render at 48 kHz, the rate of the iOS simulator and of the WAV previews. */
export const RECIPE_TEST_RATE = 48_000;
/** Quieter than this is inaudible next to the other sounds. */
export const MIN_PEAK = 0.05;
/** The synth scales mixes down to 0.9; above it would clip. */
export const MAX_PEAK = 0.9;
/** A louder first sample is an audible click (attack too short). */
export const MAX_FIRST_SAMPLE = 0.05;
/** A louder last sample is a click when the buffer stops. */
export const MAX_LAST_SAMPLE = 0.01;
/** Shorter than this is not heard as a sound. */
export const MIN_DURATION_MS = 10;
/** Effects and UI sounds stay short so a cascade of cues never piles up. */
export const MAX_EFFECT_MS = 1500;
/** Music loops may be longer. */
export const MAX_MUSIC_MS = 30_000;

const MIN_HZ = 20;
const MAX_HZ = 20_000;

function timingProblems(voice: VoiceSpec, at: string): string[] {
  const problems: string[] = [];
  if (voice.durationMs <= 0) problems.push(`${at}: durationMs must be above 0`);
  if (voice.attackMs < 0 || voice.attackMs >= voice.durationMs)
    problems.push(`${at}: attackMs must be 0 or more and shorter than durationMs`);
  if (voice.offsetMs < 0) problems.push(`${at}: offsetMs must not be negative`);
  // The first-sample check only sees the start of the sound; a later layer must fade in itself.
  if (voice.offsetMs > 0 && voice.attackMs < 1)
    problems.push(`${at}: a layer that starts later needs attackMs of 1 ms or more (it clicks)`);
  return problems;
}

function voiceProblems(voice: VoiceSpec, index: number): string[] {
  const at = `voice ${String(index)}`;
  const problems = timingProblems(voice, at);
  if (voice.gain <= 0 || voice.gain > 1) problems.push(`${at}: gain must be in (0, 1]`);
  const isTonal = voice.wave !== 'noise';
  const isAudible = [voice.startHz, voice.endHz].every((hz) => hz >= MIN_HZ && hz <= MAX_HZ);
  if (isTonal && !isAudible) problems.push(`${at}: pitch must stay within 20-20000 Hz`);
  return problems;
}

function peakOf(samples: Float32Array): number {
  return samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

function sampleProblems(samples: Float32Array): string[] {
  const problems: string[] = [];
  if (!samples.every((sample) => Number.isFinite(sample)))
    return ['renders non-finite samples (NaN or Infinity)'];
  const peak = peakOf(samples);
  if (peak < MIN_PEAK) problems.push(`peak ${peak.toFixed(3)} is below ${String(MIN_PEAK)}`);
  if (peak > MAX_PEAK) problems.push(`peak ${peak.toFixed(3)} is above ${String(MAX_PEAK)}`);
  const first = Math.abs(samples[0] ?? 1);
  const last = Math.abs(samples.at(-1) ?? 1);
  if (first >= MAX_FIRST_SAMPLE)
    problems.push(`first sample ${first.toFixed(3)} clicks: raise attackMs to 1-2 ms`);
  if (last >= MAX_LAST_SAMPLE) problems.push(`last sample ${last.toFixed(3)} clicks`);
  return problems;
}

/**
 * Empty when the recipe renders a clean, click-free, audible sound within its duration limit.
 * Each entry is one readable problem, so a test can print them all at once.
 */
export function recipeProblems(
  recipe: SoundRecipe,
  maxDurationMs: number = MAX_EFFECT_MS,
): readonly string[] {
  if (recipe.length === 0) return ['has no voices'];
  const fieldProblems = recipe.flatMap((voice, index) => voiceProblems(voice, index));
  if (fieldProblems.length > 0) return fieldProblems;
  const endMs = Math.max(...recipe.map((voice) => voice.offsetMs + voice.durationMs));
  const lengthProblems: string[] = [];
  if (endMs < MIN_DURATION_MS) lengthProblems.push(`lasts ${String(endMs)} ms (minimum 10 ms)`);
  if (endMs > maxDurationMs)
    lengthProblems.push(`lasts ${String(endMs)} ms (limit ${String(maxDurationMs)} ms)`);
  return [...lengthProblems, ...sampleProblems(synthesizeRecipe(recipe, RECIPE_TEST_RATE))];
}
