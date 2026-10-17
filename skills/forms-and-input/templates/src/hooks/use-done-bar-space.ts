// src/hooks/use-done-bar-space.ts
// The room a form's KeyboardAwareScrollView keeps for KeyboardDoneBar (forms-and-input). The bar
// rides directly on top of the keyboard, so keeping the focused field just above the keyboard is
// not enough: the bar would cover it. bottomOffset (the gap react-native-keyboard-controller keeps
// between the focused field and the keyboard) is the bar's height plus a gap, and
// extraKeyboardSpace lets the last field scroll that far up. The bar reports its measured height
// (it grows with the text size); until it does, its height at the default text size stands in.
// keyboard-controller 1.21.9 scrolls the focused field again whenever bottomOffset changes.
import { useState } from 'react';

import { SPACING } from '@/theme/tokens';
import { KEYBOARD_DONE_BAR_MIN_HEIGHT } from '@/ui/form/keyboard-done-bar';

/** The gap kept between the focused field and the top of the Done bar. */
export const DONE_BAR_GAP = SPACING.lg;

export type DoneBarSpace = {
  /** KeyboardAwareScrollView `bottomOffset`. */
  readonly bottomOffset: number;
  /** KeyboardAwareScrollView `extraKeyboardSpace`. */
  readonly extraKeyboardSpace: number;
  /** KeyboardDoneBar `onHeightChange`. */
  readonly onBarHeightChange: (height: number) => void;
};

export function useDoneBarSpace(): DoneBarSpace {
  const [barHeight, setBarHeight] = useState(KEYBOARD_DONE_BAR_MIN_HEIGHT);
  const onBarHeightChange = (height: number): void => {
    // Whole points: a fractional layout height would re-render and re-scroll for nothing.
    setBarHeight(Math.ceil(height));
  };
  return {
    bottomOffset: barHeight + DONE_BAR_GAP,
    extraKeyboardSpace: barHeight,
    onBarHeightChange,
  };
}
