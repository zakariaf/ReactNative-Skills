// src/hooks/use-window-class.ts
// Owned by the react-components-and-hooks skill. A shared cross-feature hook: layout decides by the
// window the app has now, never by the device model or a one-time Dimensions read.
import { useWindowDimensions } from 'react-native';

export type WindowWidthClass = 'compact' | 'regular';

export type WindowClass = {
  /** 'regular' from REGULAR_WIDTH_MIN wide: two panes, a centred column, side-by-side rows. */
  readonly width: WindowWidthClass;
  readonly isLandscape: boolean;
  /** The text is large enough that horizontal rows stack (accessibility-as-code's threshold). */
  readonly isLargeText: boolean;
};

/**
 * Android's compact/medium window size class boundary (600 dp). Every phone in portrait is compact,
 * and the narrowest full-screen iPad (iPad mini portrait, 744 pt) is regular; split and floating iPad
 * windows (Split View, Slide Over, Stage Manager, from about 320 pt) can be compact.
 */
export const REGULAR_WIDTH_MIN = 600;

/**
 * Between iOS Extra Extra Large (1.235) and Extra Extra Extra Large (1.353), and below Android's
 * 1.3 step, which JavaScript receives as 1.2999999523162842 (a 32-bit float widened to a double).
 */
export const LARGE_TEXT_SCALE = 1.25;

/** Pure: test it at the window table's sizes (react-components-and-hooks) and at fontScale 2. */
export function classifyWindow(width: number, height: number, fontScale: number): WindowClass {
  return {
    width: width >= REGULAR_WIDTH_MIN ? 'regular' : 'compact',
    isLandscape: width > height,
    isLargeText: fontScale >= LARGE_TEXT_SCALE,
  };
}

/**
 * The current window's class. Re-renders when the window changes: rotation, iPad Split View and
 * Stage Manager, Android multi-window and freeform windows, a foldable opening, and a change of the
 * system text size while the app runs.
 */
export function useWindowClass(): WindowClass {
  const { width, height, fontScale } = useWindowDimensions();
  return classifyWindow(width, height, fontScale);
}
