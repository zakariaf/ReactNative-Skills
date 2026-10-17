// src/hooks/use-frame-scroll-target.ts
// Where a tall parity frame's body opens (design-visual-parity): the running launch's scrollY, or
// undefined in a normal start and every production build.
import { useFrameRequest } from './use-frame-request';

/** The scroll offset a tall frame opens at (pass it to ScreenBody's scrollToY), or undefined. */
export function useFrameScrollTarget(): number | undefined {
  return useFrameRequest()?.scrollY;
}
