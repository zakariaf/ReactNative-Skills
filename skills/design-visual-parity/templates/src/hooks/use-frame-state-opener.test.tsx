// src/hooks/use-frame-state-opener.test.tsx
// no-providers: the hook reads only the frame request's context, which each test provides.
import { renderHook } from '@testing-library/react-native';

import { FrameRequestProvider } from './use-frame-request';
import { useFrameStateOpener } from './use-frame-state-opener';

import type { FrameRequest } from './use-frame-request';
import type { ReactNode } from 'react';

const REQUEST: FrameRequest = { state: 'test-dialog-open', scrollY: 240, nonce: 'a1b2c3d4' };

function withRequest(request: FrameRequest | null) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <FrameRequestProvider request={request}>{children}</FrameRequestProvider>;
  };
}

describe('useFrameStateOpener', () => {
  it('calls the handler once when the launch asks for its state', async () => {
    const open = jest.fn();
    const { rerender } = await renderHook(
      () => {
        useFrameStateOpener('test-dialog-open', open);
      },
      { wrapper: withRequest(REQUEST) },
    );
    await rerender({});

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('ignores another state and a normal start', async () => {
    const open = jest.fn();
    await renderHook(
      () => {
        useFrameStateOpener('task-menu-open', open);
      },
      { wrapper: withRequest(REQUEST) },
    );
    await renderHook(
      () => {
        useFrameStateOpener('test-dialog-open', open);
      },
      { wrapper: withRequest(null) },
    );

    expect(open).not.toHaveBeenCalled();
  });
});
