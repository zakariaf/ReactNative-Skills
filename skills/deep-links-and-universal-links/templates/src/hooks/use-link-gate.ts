// src/hooks/use-link-gate.ts
// Called by the component that owns a Stack.Protected guard (the session provider, the root stack),
// with the same boolean the guard reads: +native-intent then opens a gated link at once while the
// gate is open, and keeps it for useOpenPendingLink while it is closed. Unmounting closes the gate.
import { useEffect } from 'react';

import { linkGates } from '@/services/deep-links/link-gates';

/** Reports whether `gate` ('signed-in') is open, for incoming links. */
export function useLinkGate(gate: string, isOpen: boolean): void {
  useEffect(() => {
    linkGates.set(gate, isOpen);
    return () => {
      linkGates.set(gate, false);
    };
  }, [gate, isOpen]);
}
