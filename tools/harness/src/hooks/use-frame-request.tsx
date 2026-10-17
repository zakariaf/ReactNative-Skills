// src/hooks/use-frame-request.tsx
// What a parity launch (design-visual-parity) asks of the screens: the frame state to open, the
// scroll offset of a tall frame and the launch's nonce. Production code: the test-only parity root
// provides the request in a development or preview build; a production build never does, so every
// reader gets null and nothing changes. A screen's model opens its frame state with
// useFrameStateOpener (use-frame-state-opener.ts), through the same handler a person's press uses,
// and a tall screen scrolls with useFrameScrollTarget (use-frame-scroll-target.ts), so a capture shows
// the real code path and there is no capture-only branch anywhere. Only those two hooks, the launch
// marker and the parity harness read the request.
import { createContext, use } from 'react';

import type { ReactNode } from 'react';

export type FrameRequest = {
  /** The frame state the owning model opens (contracts/visual-parity.json plans), or null. */
  readonly state: string | null;
  /** Where a tall frame's body opens (pt from the top of its content). */
  readonly scrollY: number | undefined;
  /** This launch's nonce: the launch marker shows it, so a capture proves which launch it saw. */
  readonly nonce: string;
};

const FrameRequestContext = createContext<FrameRequest | null>(null);

export type FrameRequestProviderProps = {
  readonly request: FrameRequest | null;
  readonly children: ReactNode;
};

export function FrameRequestProvider({ request, children }: FrameRequestProviderProps): ReactNode {
  return <FrameRequestContext value={request}>{children}</FrameRequestContext>;
}

/** The parity launch's request, or null (every normal start, and every production build). */
export function useFrameRequest(): FrameRequest | null {
  return use(FrameRequestContext);
}
