// src/features/parity/parity-frame-root.tsx
// The test build's wrapper around the navigator for parity captures: it turns the running launch into
// the screens' FrameRequest (the frame state to open, none in a probe launch; the scroll offset; the
// nonce) and draws the launch marker. The root stack renders it as TEST_ONLY?.ParityFrameRoot around
// its children; with no launch it provides null and draws nothing.
import { useSyncExternalStore } from 'react';

import { FrameRequestProvider } from '@/hooks/use-frame-request';
import { ParityLaunchMarker } from '@/ui/parity-launch-marker';

import { currentParityRequest, subscribeParitySession } from './parity-session';

import type { FrameRequest } from '@/hooks/use-frame-request';
import type { ReactNode } from 'react';

export type ParityFrameRootProps = {
  readonly children: ReactNode;
};

export function ParityFrameRoot({ children }: ParityFrameRootProps): ReactNode {
  const request = useSyncExternalStore(
    subscribeParitySession,
    currentParityRequest,
    currentParityRequest,
  );
  const frame: FrameRequest | null =
    request === null
      ? null
      : {
          state: request.probe === null ? request.plan.state : null,
          scrollY: request.scrollY,
          nonce: request.nonce,
        };
  return (
    <FrameRequestProvider request={frame}>
      <ParityLaunchMarker />
      {children}
    </FrameRequestProvider>
  );
}
