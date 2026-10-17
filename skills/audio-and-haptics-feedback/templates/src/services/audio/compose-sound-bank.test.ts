// src/services/audio/compose-sound-bank.test.ts
import { UI_SOUND_BANK, composeSoundBank, hasMusic } from './compose-sound-bank';
import { UI_SOUNDS } from './synth/ui-sounds';

import type { SoundBank } from './audio-port';

const COMPLETE: SoundBank = {
  complete: {
    category: 'sfx',
    recipe: [
      {
        wave: 'triangle',
        startHz: 520,
        endHz: 380,
        offsetMs: 0,
        durationMs: 70,
        attackMs: 2,
        gain: 0.5,
      },
    ],
  },
};

const recipe = COMPLETE['complete']?.recipe ?? [];

describe('composeSoundBank', () => {
  it('loads the UI sounds as the ui category beside the feature banks', () => {
    const bank = composeSoundBank(COMPLETE, { goal: { category: 'sfx', recipe } });
    expect(Object.keys(bank).sort()).toStrictEqual(
      ['complete', 'goal', ...Object.keys(UI_SOUNDS)].sort(),
    );
    expect(Object.values(UI_SOUND_BANK).every((spec) => spec.category === 'ui')).toBe(true);
  });

  it('throws when a feature sound uses the ui. namespace', () => {
    expect(() => composeSoundBank({ 'ui.toggle': { category: 'sfx', recipe } })).toThrow(
      'Sound ids clash with the ui. namespace or another bank: ui.toggle',
    );
  });

  it('throws when two banks share an id', () => {
    expect(() => composeSoundBank(COMPLETE, COMPLETE)).toThrow(
      'Sound ids clash with the ui. namespace or another bank: complete',
    );
  });
});

describe('hasMusic', () => {
  it('is true only when some sound is in the music category', () => {
    expect(hasMusic(composeSoundBank(COMPLETE))).toBe(false);
    expect(hasMusic({ theme: { category: 'music', recipe, isLoop: true } })).toBe(true);
  });
});
