// src/hooks/use-frame-scroll-target.test.tsx
// no-providers: the hook reads only the frame request's context, which each test provides.
import { renderHook } from '@testing-library/react-native';

import { FrameRequestProvider } from './use-frame-request';
import { useFrameScrollTarget } from './use-frame-scroll-target';

import type { FrameRequest } from './use-frame-request';
import type { ReactNode } from 'react';

function withRequest(request: FrameRequest | null) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <FrameRequestProvider request={request}>{children}</FrameRequestProvider>;
  };
}

describe('useFrameScrollTarget', () => {
  it("is the launch's scroll offset inside a parity launch", async () => {
    const request: FrameRequest = { state: null, scrollY: 240, nonce: 'a1b2c3d4' };
    const { result } = await renderHook(() => useFrameScrollTarget(), {
      wrapper: withRequest(request),
    });

    expect(result.current).toBe(240);
  });

  it('is undefined in a normal start', async () => {
    const { result } = await renderHook(() => useFrameScrollTarget(), {
      wrapper: withRequest(null),
    });

    expect(result.current).toBeUndefined();
  });
});
