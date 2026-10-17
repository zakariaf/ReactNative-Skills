// src/hooks/use-frame-request.test.tsx
// no-providers: the hook reads only its own context, which each test provides.
import { renderHook } from '@testing-library/react-native';

import { FrameRequestProvider, useFrameRequest } from './use-frame-request';

import type { FrameRequest } from './use-frame-request';
import type { ReactNode } from 'react';

const REQUEST: FrameRequest = { state: 'test-dialog-open', scrollY: 240, nonce: 'a1b2c3d4' };

function withRequest(request: FrameRequest | null) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <FrameRequestProvider request={request}>{children}</FrameRequestProvider>;
  };
}

describe('useFrameRequest', () => {
  it('is null outside a parity launch', async () => {
    const { result } = await renderHook(() => useFrameRequest());

    expect(result.current).toBeNull();
  });

  it('returns the request inside one', async () => {
    const { result } = await renderHook(() => useFrameRequest(), {
      wrapper: withRequest(REQUEST),
    });

    expect(result.current).toStrictEqual(REQUEST);
  });
});
