// __mocks__/@rive-app/react-native.tsx — root manual mock (automatic in every Jest project).
// Owned by the lottie-and-rive skill. @rive-app/react-native 0.5.5 is a Nitro module: importing it
// in Jest fails because no native HybridObject exists. This mock keeps the surface the app's
// rive-moment.tsx uses: RiveView renders a host element named RiveView (testID 'rive.view') that
// keeps every prop (file, autoPlay, stateMachineName, frameRate); useRiveFile returns a loaded file
// at once; useRive returns a ready view whose play() and pause() calls land in `riveViewCalls`.
// Read it in a test through `import * as RiveModule from '@rive-app/react-native'` (jest.requireMock
// returns another instance).
import { createElement } from 'react';

import type { ReactNode } from 'react';

/** Every play() and pause() call, in order. A test empties it in beforeEach (riveViewCalls.length = 0). */
export const riveViewCalls: ('play' | 'pause')[] = [];

/** Plain functions, not jest.fn(): restoreMocks would empty a jest.fn()'s implementation, and the app awaits these. */
export const riveViewMethods = {
  play: (): Promise<void> => {
    riveViewCalls.push('play');
    return Promise.resolve();
  },
  pause: (): Promise<void> => {
    riveViewCalls.push('pause');
    return Promise.resolve();
  },
  playIfNeeded: (): void => undefined,
};

/** The stand-in for a loaded RiveFile; tests compare against it. */
export const loadedRiveFile = { __mock: 'RiveFile' };

export const Fit = { Contain: 'contain', Cover: 'cover', Fill: 'fill', Layout: 'layout' } as const;
export const Alignment = { Center: 'center' } as const;

export function RiveView(props: Record<string, unknown>): ReactNode {
  return createElement('RiveView', { testID: 'rive.view', ...props });
}

export function useRiveFile(): { riveFile: typeof loadedRiveFile; isLoading: false; error: null } {
  return { riveFile: loadedRiveFile, isLoading: false, error: null };
}

export function useRive(): {
  riveRef: { current: typeof riveViewMethods };
  riveViewRef: typeof riveViewMethods;
  setHybridRef: { f: () => void };
} {
  return {
    riveRef: { current: riveViewMethods },
    riveViewRef: riveViewMethods,
    setHybridRef: { f: () => undefined },
  };
}
