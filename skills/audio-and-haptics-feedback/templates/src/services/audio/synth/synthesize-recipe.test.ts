// src/services/audio/synth/synthesize-recipe.test.ts
import { RECIPE_TEST_RATE, recipeProblems } from './recipe-problems';
import { synthesizeRecipe } from './synthesize-recipe';
import { UI_SOUNDS } from './ui-sounds';

describe('synthesizeRecipe', () => {
  it.each(Object.entries(UI_SOUNDS))('renders %s as a clean, click-free buffer', (_id, recipe) => {
    expect(recipeProblems(recipe)).toStrictEqual([]);
  });

  it('renders identical bytes every time (seeded noise, no clocks)', () => {
    const noisy = [
      {
        wave: 'noise',
        startHz: 0,
        endHz: 0,
        offsetMs: 0,
        durationMs: 80,
        attackMs: 1,
        gain: 0.5,
        seed: 9,
      },
    ] as const;
    expect(synthesizeRecipe(noisy, RECIPE_TEST_RATE)).toStrictEqual(
      synthesizeRecipe(noisy, RECIPE_TEST_RATE),
    );
  });

  it('mixes layers at their offsets and scales loud mixes down to 0.9', () => {
    const tone = {
      wave: 'sine',
      startHz: 440,
      endHz: 440,
      offsetMs: 0,
      durationMs: 100,
      attackMs: 2,
      gain: 1,
    } as const;
    const samples = synthesizeRecipe([tone, { ...tone, offsetMs: 50 }], RECIPE_TEST_RATE);
    const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    expect(samples).toHaveLength((150 / 1000) * RECIPE_TEST_RATE);
    expect(peak).toBeCloseTo(0.9, 5);
  });
});
