// src/features/__FEATURE__/sounds/__FEATURE__-sounds.test.ts
import {
  MAX_EFFECT_MS,
  MAX_MUSIC_MS,
  RECIPE_TEST_RATE,
  recipeProblems,
} from '@/services/audio/synth/recipe-problems';
import { synthesizeRecipe } from '@/services/audio/synth/synthesize-recipe';

import { __FEATURE_SOUNDS__ } from './__FEATURE__-sounds';

// One alias keeps every line below the same length whatever the bank is called (Prettier-stable).
const BANK = __FEATURE_SOUNDS__;
const KEBAB_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const peakOf = (samples: Float32Array): number =>
  samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);

describe('__FEATURE_SOUNDS__', () => {
  it.each(Object.entries(BANK))('renders %s as a clean, click-free sound', (_id, spec) => {
    const limit = spec.category === 'music' ? MAX_MUSIC_MS : MAX_EFFECT_MS;
    expect(recipeProblems(spec.recipe, limit)).toStrictEqual([]);
  });

  it('keeps its ids kebab-case and out of the ui. namespace', () => {
    expect(Object.keys(BANK).filter((id) => !KEBAB_ID.test(id))).toStrictEqual([]);
  });

  it('makes the most repeated sound the quietest', () => {
    const peaks = Object.entries(BANK).map(
      ([id, spec]) => [id, peakOf(synthesizeRecipe(spec.recipe, RECIPE_TEST_RATE))] as const,
    );
    const quietest = [...peaks].sort((a, b) => a[1] - b[1])[0]?.[0];
    expect(quietest).toBe('complete');
  });
});
