// src/services/audio/synth/recipe-problems.test.ts
import { MAX_EFFECT_MS, recipeProblems } from './recipe-problems';

import type { VoiceSpec } from './synthesize-recipe';

const CLEAN: VoiceSpec = {
  wave: 'triangle',
  startHz: 520,
  endHz: 380,
  offsetMs: 0,
  durationMs: 70,
  attackMs: 2,
  gain: 0.5,
};

describe('recipeProblems', () => {
  it('accepts a clean, short effect', () => {
    expect(recipeProblems([CLEAN])).toStrictEqual([]);
  });

  it('reports a click when the attack is too short for a loud triangle', () => {
    expect(recipeProblems([{ ...CLEAN, attackMs: 0, gain: 0.8 }])).toStrictEqual([
      expect.stringContaining('first sample'),
    ]);
  });

  it('reports a sound too quiet to hear', () => {
    expect(recipeProblems([{ ...CLEAN, gain: 0.02 }])).toStrictEqual([
      expect.stringContaining('below 0.05'),
    ]);
  });

  it('reports an effect longer than its limit and accepts it as music', () => {
    const long = [{ ...CLEAN, durationMs: 2000 }];
    expect(recipeProblems(long)).toStrictEqual([
      `lasts 2000 ms (limit ${String(MAX_EFFECT_MS)} ms)`,
    ]);
    expect(recipeProblems(long, 30_000)).toStrictEqual([]);
  });

  it('reports a later layer without its own fade-in (a click in the middle of the sound)', () => {
    expect(
      recipeProblems([CLEAN, { ...CLEAN, wave: 'square', offsetMs: 30, attackMs: 0 }]),
    ).toStrictEqual([
      'voice 1: a layer that starts later needs attackMs of 1 ms or more (it clicks)',
    ]);
  });

  it('reports empty recipes and broken voice fields without rendering them', () => {
    expect(recipeProblems([])).toStrictEqual(['has no voices']);
    expect(recipeProblems([{ ...CLEAN, startHz: 0, attackMs: 90 }])).toStrictEqual([
      'voice 0: attackMs must be 0 or more and shorter than durationMs',
      'voice 0: pitch must stay within 20-20000 Hz',
    ]);
  });
});
