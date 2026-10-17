// synth.mjs: a line-for-line JavaScript port of the app's synth (templates/src/services/audio/synth/
// synthesize-recipe.ts), the sfc32 PRNG it uses (src/core/rng/sfc32.ts) and a 16-bit mono WAV encoder.
// Not an entry point.
//
// It must render byte-identical samples to the TypeScript synth: selfCheck() verifies a pinned sha256
// of one rendered WAV at startup, exactly like the sfc32 golden sequence, and check-sound-banks'
// synth-drift rule renders the same golden recipe with the app's own synthesizeRecipe.

import { createHash } from 'node:crypto';

// ---- sfc32 (the app's seeded PRNG): only 32-bit integer operations, identical on every engine ----

const GOLDEN_GAMMA = 0x9e3779b9;
const WARM_UP_DRAWS = 12;

function mix32(value) {
  let z = value | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

export function nextU32(state) {
  const [a, b, c, d] = state;
  const t = (((a + b) | 0) + d) | 0;
  const nextD = (d + 1) | 0;
  const nextA = b ^ (b >>> 9);
  const nextB = (c + (c << 3)) | 0;
  const rotated = (c << 21) | (c >>> 11);
  const nextC = (rotated + t) | 0;
  return { value: t >>> 0, state: [nextA >>> 0, nextB >>> 0, nextC >>> 0, nextD >>> 0] };
}

export function seedRng(seed) {
  const s = seed | 0;
  let state = [mix32(s + GOLDEN_GAMMA), mix32(s + 2 * GOLDEN_GAMMA), mix32(s + 3 * GOLDEN_GAMMA), mix32(s + 4 * GOLDEN_GAMMA)];
  for (let i = 0; i < WARM_UP_DRAWS; i += 1) state = nextU32(state).state;
  return state;
}

// ---- the synth ----

const TWO_PI = 2 * Math.PI;
const FADE_OUT_MS = 6;
const PEAK_LIMIT = 0.9;

function oscillate(wave, phase, noise) {
  switch (wave) {
    case 'sine':
      return Math.sin(TWO_PI * phase);
    case 'triangle':
      return 1 - 4 * Math.abs(phase - Math.floor(phase + 0.5));
    case 'square':
      return phase % 1 < 0.5 ? 0.6 : -0.6;
    case 'noise':
      return noise;
    default:
      throw new Error(`unknown wave "${wave}"`);
  }
}

function envelope(i, shape) {
  const rise = shape.attack > 0 ? Math.min(1, i / shape.attack) : 1;
  const left = (shape.total - i) / shape.total;
  const tail = Math.max(0, Math.min(1, (shape.total - 1 - i) / shape.fade));
  return rise * left * left * tail;
}

export function synthesizeVoice(spec, sampleRate) {
  const shape = {
    total: Math.round((spec.durationMs / 1000) * sampleRate),
    attack: (spec.attackMs / 1000) * sampleRate,
    fade: (FADE_OUT_MS / 1000) * sampleRate,
  };
  const out = new Float32Array(shape.total);
  let rng = seedRng(spec.seed ?? 1);
  let phase = 0;
  for (let i = 0; i < shape.total; i += 1) {
    phase += (spec.startHz + (spec.endHz - spec.startHz) * (i / shape.total)) / sampleRate;
    const draw = nextU32(rng);
    rng = draw.state;
    out[i] = oscillate(spec.wave, phase, draw.value / 2147483648 - 1) * spec.gain * envelope(i, shape);
  }
  return out;
}

export function synthesizeRecipe(recipe, sampleRate) {
  const endMs = Math.max(...recipe.map((voice) => voice.offsetMs + voice.durationMs));
  const mix = new Float32Array(Math.round((endMs / 1000) * sampleRate));
  for (const voice of recipe) {
    const start = Math.round((voice.offsetMs / 1000) * sampleRate);
    synthesizeVoice(voice, sampleRate).forEach((sample, i) => {
      if (start + i < mix.length) mix[start + i] = (mix[start + i] ?? 0) + sample;
    });
  }
  const peak = mix.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  return peak > PEAK_LIMIT ? mix.map((sample) => (sample * PEAK_LIMIT) / peak) : mix;
}

// ---- the quality gate (same limits as the app's recipe-problems.ts) ----

export const RATE = 48000;
export const LIMITS = Object.freeze({
  minPeak: 0.05,
  maxPeak: 0.9,
  maxFirstSample: 0.05,
  maxLastSample: 0.01,
  minDurationMs: 10,
  maxEffectMs: 1500,
  maxMusicMs: 30000,
});
const WAVES = new Set(['sine', 'triangle', 'square', 'noise']);
const NUMBER_FIELDS = ['startHz', 'endHz', 'offsetMs', 'durationMs', 'attackMs', 'gain'];

/** Shape problems of one voice object read from source (fields, types, ranges). */
export function voiceProblems(voice, index) {
  const at = `voice ${index}`;
  if (voice === null || typeof voice !== 'object' || Array.isArray(voice)) return [`${at}: is not an object literal`];
  const problems = [];
  if (!WAVES.has(voice.wave)) problems.push(`${at}: wave must be 'sine', 'triangle', 'square' or 'noise'`);
  for (const field of NUMBER_FIELDS) {
    if (typeof voice[field] !== 'number' || !Number.isFinite(voice[field])) problems.push(`${at}: ${field} must be a literal number`);
  }
  if (voice.seed !== undefined && !Number.isInteger(voice.seed)) problems.push(`${at}: seed must be an integer`);
  if (problems.length > 0) return problems;
  if (voice.durationMs <= 0) problems.push(`${at}: durationMs must be above 0`);
  if (voice.attackMs < 0 || voice.attackMs >= voice.durationMs) problems.push(`${at}: attackMs must be 0 or more and shorter than durationMs`);
  if (voice.offsetMs < 0) problems.push(`${at}: offsetMs must not be negative`);
  if (voice.offsetMs > 0 && voice.attackMs < 1) problems.push(`${at}: a layer that starts later needs attackMs of 1 ms or more (it clicks)`);
  if (voice.gain <= 0 || voice.gain > 1) problems.push(`${at}: gain must be in (0, 1]`);
  const audible = [voice.startHz, voice.endHz].every((hz) => hz >= 20 && hz <= 20000);
  if (voice.wave !== 'noise' && !audible) problems.push(`${at}: pitch must stay within 20-20000 Hz`);
  return problems;
}

/** All problems of a recipe (array of voices); renders it only when the fields are sound. */
export function recipeProblems(recipe, maxDurationMs) {
  if (!Array.isArray(recipe)) return ['recipe is not an array literal of voices'];
  if (recipe.length === 0) return ['has no voices'];
  const fields = recipe.flatMap((voice, index) => voiceProblems(voice, index));
  if (fields.length > 0) return fields;
  const problems = [];
  const endMs = Math.max(...recipe.map((voice) => voice.offsetMs + voice.durationMs));
  if (endMs < LIMITS.minDurationMs) problems.push(`lasts ${endMs} ms (minimum ${LIMITS.minDurationMs} ms)`);
  if (endMs > maxDurationMs) problems.push(`lasts ${endMs} ms (limit ${maxDurationMs} ms)`);
  const samples = synthesizeRecipe(recipe, RATE);
  if (!samples.every((sample) => Number.isFinite(sample))) return [...problems, 'renders non-finite samples (NaN or Infinity)'];
  const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  if (peak < LIMITS.minPeak) problems.push(`peak ${peak.toFixed(3)} is below ${LIMITS.minPeak} (inaudible)`);
  if (peak > LIMITS.maxPeak) problems.push(`peak ${peak.toFixed(3)} is above ${LIMITS.maxPeak} (clips)`);
  const first = Math.abs(samples[0] ?? 1);
  const last = Math.abs(samples.at(-1) ?? 1);
  if (first >= LIMITS.maxFirstSample) problems.push(`first sample ${first.toFixed(3)} clicks (attack too short)`);
  if (last >= LIMITS.maxLastSample) problems.push(`last sample ${last.toFixed(3)} clicks`);
  return problems;
}

// ---- WAV ----

export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, i) => {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  });
  return new Uint8Array(view.buffer);
}

// ---- self-check against the TypeScript synth ----

/** The template bank's 'streak' (a sine sweep over seeded noise), rendered by the TypeScript synth at 48 kHz. */
export const GOLDEN_RECIPE = [
  { wave: 'sine', startHz: 300, endHz: 1200, offsetMs: 0, durationMs: 240, attackMs: 8, gain: 0.45 },
  { wave: 'noise', startHz: 0, endHz: 0, offsetMs: 0, durationMs: 160, attackMs: 4, gain: 0.15, seed: 3 },
];
export const GOLDEN_WAV_SHA256 = 'd91b7984ab8f27b3ea93ec3dd31877b0a25047519351af69634ca7670b2b2253';
const GOLDEN_SFC32_SEED_1 = [1828152527, 3394835397, 2967886022, 2251045104, 4148684523];

/** Throws when this port no longer matches the app's synth or PRNG (so every result would be wrong). */
export function selfCheck() {
  let state = seedRng(1);
  const draws = [];
  for (let i = 0; i < GOLDEN_SFC32_SEED_1.length; i += 1) {
    const draw = nextU32(state);
    draws.push(draw.value);
    state = draw.state;
  }
  if (draws.join(',') !== GOLDEN_SFC32_SEED_1.join(',')) throw new Error(`sfc32 port drifted: seedRng(1) gives ${draws.join(',')}`);
  const hash = createHash('sha256').update(encodeWav(synthesizeRecipe(GOLDEN_RECIPE, RATE), RATE)).digest('hex');
  if (hash !== GOLDEN_WAV_SHA256) throw new Error(`synth port drifted: golden WAV sha256 ${hash}`);
}
