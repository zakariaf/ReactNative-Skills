// src/hooks/use-frame-state-opener.ts
// The one way a screen's model opens a parity frame state (design-visual-parity): through the handler
// a person's press uses, once, when the running parity launch asks for that state. Production code: a
// normal start and every production build have no request, so it never opens anything.
import { useEffect, useRef } from 'react';

import { useFrameRequest } from './use-frame-request';

/**
 * Opens `state` once, on mount, when a parity launch asks for it: `open` is the handler a person's
 * press would call (open the dialog, press Buy, tap the locked tile).
 */
export function useFrameStateOpener(state: string, open: () => void): void {
  const request = useFrameRequest();
  const hasOpened = useRef(false);
  useEffect(() => {
    if (hasOpened.current || request?.state !== state) return;
    hasOpened.current = true;
    open();
  }, [request, state, open]);
}
