// src/features/__FEATURE__/__FEATURE__-feedback.test.ts
import { __FEATURE_SOUNDS__ } from '@/features/__FEATURE__/sounds/__FEATURE__-sounds';

import { __FEATURE_FEEDBACK__ } from './__FEATURE__-feedback';

describe('__FEATURE_FEEDBACK__', () => {
  it('names only sounds of the feature bank', () => {
    const unknown = Object.values(__FEATURE_FEEDBACK__)
      .map((cue) => cue.sound)
      .filter((id) => !Object.hasOwn(__FEATURE_SOUNDS__, id));
    expect(unknown).toStrictEqual([]);
  });
});
