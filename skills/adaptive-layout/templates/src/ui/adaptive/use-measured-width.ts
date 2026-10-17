// src/ui/adaptive/use-measured-width.ts
// Owned by the adaptive-layout skill. The width of one container, for layout inside a pane: a grid
// in the detail pane of a 13-inch iPad gets the pane's width, not the window's, so it reads its own
// box through onLayout. The width is null until the first layout, and whole points (floored), so a
// grid computed from it never overflows by a fraction of a point.
import { useState } from 'react';

import type { LayoutChangeEvent } from 'react-native';

export type MeasuredWidth = {
  /** The container's width in whole points, or null before its first layout. */
  readonly width: number | null;
  /** Pass to the measured container's onLayout. */
  readonly onLayout: (event: LayoutChangeEvent) => void;
};

/** Measures the container it is attached to; re-renders only when the whole-point width changes. */
export function useMeasuredWidth(): MeasuredWidth {
  const [width, setWidth] = useState<number | null>(null);
  function handleLayout(event: LayoutChangeEvent): void {
    const next = Math.floor(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  }
  return { width, onLayout: handleLayout };
}
