// __mocks__/lottie-react-native.tsx — root manual mock (automatic in every Jest project).
// Owned by the lottie-and-rive skill. lottie-react-native 7.3.8 renders a native Fabric view that
// Jest cannot draw. This mock renders a host element named LottieAnimationView (testID
// 'lottie.view') that keeps every prop (source, progress, autoPlay, loop, onAnimationFinish), so a
// test reads what the app asked for and calls onAnimationFinish itself; the ref methods are the shared jest.fn()s in
// `lottieViewMethods` (cleared between tests by clearMocks). Read them in a test through
// `import * as LottieModule from 'lottie-react-native'` (jest.requireMock returns another instance).
import { createElement, useImperativeHandle } from 'react';

import type { ReactNode, Ref } from 'react';

export const lottieViewMethods = {
  play: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  reset: jest.fn(),
};

type MockLottieProps = Record<string, unknown> & { readonly ref?: Ref<typeof lottieViewMethods> };

function LottieView({ ref, ...props }: MockLottieProps): ReactNode {
  useImperativeHandle(ref, () => lottieViewMethods);
  return createElement('LottieAnimationView', { testID: 'lottie.view', ...props });
}

// The real package's entry exports the view as its default export.
export default LottieView;
