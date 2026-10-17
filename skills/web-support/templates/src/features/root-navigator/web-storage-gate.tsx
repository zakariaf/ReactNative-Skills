// src/features/root-navigator/web-storage-gate.tsx
// Holds the app until device storage answers synchronous calls (web-support). The root layout returns
// it as its outermost element, around DirectionGate (anything outside it renders before the warm-up,
// and in the static HTML, where a right-to-left visitor's restart screen would not match the page):
//   const [storageWarmUp] = useState(openDeviceWebStorage);
//   <WebStorageGate warmUp={storageWarmUp} onError={...} inUseElsewhere={...} unsupported={...}>
//     <DirectionGate ...>
//       <AppRoot ... />
// On iOS and Android warmUp is null and the children render on the first render, so nothing changes
// there. In the web build it renders nothing until the expo-sqlite worker has started (a few hundred
// ms), then the children. It renders inUseElsewhere when another tab of the app owns the storage (a
// second tab cannot open the database files), and unsupported when the page is not cross-origin
// isolated (no SharedArrayBuffer: the first synchronous call would throw). A failed warm-up is
// reported and the children render anyway, so the error boundary shows the storage failure instead
// of a blank page. While Expo renders static HTML it renders nothing too, so the browser's first
// render matches it.
import { useEffect, useEffectEvent, useState } from 'react';

import type { ReactNode } from 'react';

/** What the warm-up found (the data layer's StorageWarmUpResult). */
type WarmUpResult = 'ready' | 'in-use-elsewhere' | 'unsupported';

type GateState = 'waiting' | WarmUpResult;

export type WebStorageGateProps = {
  /** Resolves when synchronous storage calls work; null when there is nothing to wait for. */
  readonly warmUp: (() => Promise<WarmUpResult>) | null;
  /** Receives a failed warm-up (the error net's report). */
  readonly onError: (error: unknown) => void;
  /** Shown instead of the app while another browser tab of it holds the storage. */
  readonly inUseElsewhere: ReactNode;
  /** Shown instead of the app when this browser cannot run the storage (not cross-origin isolated). */
  readonly unsupported: ReactNode;
  readonly children: ReactNode;
};

export function WebStorageGate(props: WebStorageGateProps): ReactNode {
  const { warmUp, inUseElsewhere, unsupported, children } = props;
  const [state, setState] = useState<GateState>(warmUp === null ? 'ready' : 'waiting');
  // An effect event: a new onError never restarts the warm-up.
  const reportFailure = useEffectEvent((error: unknown) => {
    props.onError(error);
  });

  useEffect(() => {
    if (warmUp === null) return undefined;
    let isMounted = true;
    const settle = (next: WarmUpResult): void => {
      if (isMounted) setState(next);
    };
    warmUp().then(settle, (error: unknown) => {
      reportFailure(error);
      settle('ready');
    });
    return () => {
      isMounted = false;
    };
  }, [warmUp]);

  if (state === 'waiting') return null;
  if (state === 'in-use-elsewhere') return inUseElsewhere;
  return state === 'unsupported' ? unsupported : children;
}
