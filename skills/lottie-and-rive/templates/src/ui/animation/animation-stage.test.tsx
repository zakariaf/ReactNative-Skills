// src/ui/animation/animation-stage.test.tsx
// no-providers: the stage is the provider under test; each test passes its own wrapper.
import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';

import { AnimationStageProvider, createAnimationStage, useAnimationSlot } from './animation-stage';

import type { AnimationWeight } from './animation-playback';

/** Two moments on one screen; the first one's wish to play can be switched off. */
function useTwoMoments(first: AnimationWeight, second: AnimationWeight) {
  const [isFirstPlaying, setIsFirstPlaying] = useState(true);
  return {
    first: useAnimationSlot(first, isFirstPlaying),
    second: useAnimationSlot(second, true),
    finishFirst: () => {
      setIsFirstPlaying(false);
    },
  };
}

describe('createAnimationStage', () => {
  it('lets the first heavy moment in the queue play and hands over when it leaves', () => {
    const stage = createAnimationStage();
    stage.enqueue('a');
    stage.enqueue('b');
    expect(stage.holder()).toBe('a');
    stage.leave('a');
    expect(stage.holder()).toBe('b');
    stage.leave('b');
    expect(stage.holder()).toBeNull();
  });
});

describe('useAnimationSlot', () => {
  it('plays one heavy moment at a time and hands the stage over when it is done', async () => {
    const { result } = await renderHook(() => useTwoMoments('heavy', 'heavy'), {
      wrapper: AnimationStageProvider,
    });
    expect(result.current.first).toBe(true);
    expect(result.current.second).toBe(false);

    await act(() => {
      result.current.finishFirst();
    });
    expect(result.current.second).toBe(true);
  });

  it('lets a light moment play at once', async () => {
    const { result } = await renderHook(() => useTwoMoments('heavy', 'light'), {
      wrapper: AnimationStageProvider,
    });
    expect(result.current.first).toBe(true);
    expect(result.current.second).toBe(true);
  });
});
