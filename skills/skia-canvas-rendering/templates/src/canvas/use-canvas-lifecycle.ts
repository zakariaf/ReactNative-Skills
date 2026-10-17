// src/canvas/use-canvas-lifecycle.ts
import { useEffect, useEffectEvent } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

export type LifecycleInput = {
  /** useIsFocused() from expo-router (React Navigation 7: from @react-navigation/native). */
  readonly isFocused: boolean;
  /**
   * Something full-screen covers the surface while the screen stays focused (a video, a modal
   * sheet presented over it, an interstitial). False when nothing does.
   */
  readonly isInterrupted: boolean;
  /** Stop the frame callback, cancel cues, suspend audio. */
  readonly onPause: () => void;
  /** Resume audio; the clock finishes an interrupted timeline and starts a held scene. */
  readonly onResume: () => void;
  /** Debug builds: any of the three facts changed (the clock trace), before onPause/onResume. */
  readonly onFlags?: (flags: RunnableFlags) => void;
};

/** The three facts behind the decision (the clock trace records them). */
export type RunnableFlags = {
  readonly isAppActive: boolean;
  readonly isFocused: boolean;
  readonly isInterrupted: boolean;
};

/** ONE place decides whether the surface may run: app active AND focused AND not covered. */
export function useCanvasLifecycle(input: LifecycleInput): void {
  const isAppActive = useIsAppActive();
  const { isFocused, isInterrupted } = input;
  const isRunnable = isAppActive && isFocused && !isInterrupted;
  const handleFlags = useEffectEvent((flags: RunnableFlags) => {
    input.onFlags?.(flags);
  });
  const handleChange = useEffectEvent((isNowRunnable: boolean) => {
    if (isNowRunnable) input.onResume();
    else input.onPause();
  });
  // Declared first: effects run in order, so a trace sees the facts before the decision.
  useEffect(() => {
    handleFlags({ isAppActive, isFocused, isInterrupted });
  }, [isAppActive, isFocused, isInterrupted]);
  useEffect(() => {
    handleChange(isRunnable);
  }, [isRunnable]);
}
