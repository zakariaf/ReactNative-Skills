// src/services/audio/synth/synthesize-recipe.ts
// Pure synthesis: data in, Float32Array out. The same code runs on device and in Jest, and the
// audio-and-haptics-feedback checker carries a byte-exact port of it (its WAV previews and quality
// gate, kept honest by its synth-drift rule). Noise is seeded, so every render is byte-identical.
import { nextU32, seedRng } from '@/core/rng/sfc32';

export type Wave = 'sine' | 'triangle' | 'square' | 'noise';

/** One layer of a sound: a pitch glide with a linear attack and a quadratic decay. */
export type VoiceSpec = {
  readonly wave: Wave;
  readonly startHz: number;
  readonly endHz: number;
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly attackMs: number;
  /** Peak amplitude 0…1 before mixing. */
  readonly gain: number;
  /** Only for 'noise'. */
  readonly seed?: number;
};

export type SoundRecipe = readonly VoiceSpec[];

type Samples = Float32Array<ArrayBuffer>;

const TWO_PI = 2 * Math.PI;
const FADE_OUT_MS = 6;
const PEAK_LIMIT = 0.9;

function oscillate(wave: Wave, phase: number, noise: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(TWO_PI * phase);
    case 'triangle':
      return 1 - 4 * Math.abs(phase - Math.floor(phase + 0.5));
    case 'square':
      return phase % 1 < 0.5 ? 0.6 : -0.6;
    case 'noise':
      return noise;
  }
}

type EnvelopeShape = { readonly total: number; readonly attack: number; readonly fade: number };

/** Attack ramp, quadratic decay, and a short fade so the last sample is exactly 0 (no click). */
function envelope(i: number, shape: EnvelopeShape): number {
  const rise = shape.attack > 0 ? Math.min(1, i / shape.attack) : 1;
  const left = (shape.total - i) / shape.total;
  const tail = Math.max(0, Math.min(1, (shape.total - 1 - i) / shape.fade));
  return rise * left * left * tail;
}

export function synthesizeVoice(spec: VoiceSpec, sampleRate: number): Samples {
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
    out[i] =
      oscillate(spec.wave, phase, draw.value / 2147483648 - 1) * spec.gain * envelope(i, shape);
  }
  return out;
}

/** Mixes all voices at their offsets; if layers sum above 0.9 the whole sound is scaled down. */
export function synthesizeRecipe(recipe: SoundRecipe, sampleRate: number): Samples {
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
