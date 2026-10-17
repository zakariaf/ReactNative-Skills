// src/features/parity/parity-launch-root.tsx
// The parity launch route's content (src/app/(debug)/debug/parity.tsx renders it through TEST_ONLY):
// runs the launch once and shows nothing while it works, the frame's route once it has replaced
// itself, or the error screen when the launch was refused.
import { useEffect, useRef, useState } from 'react';

import { ParityErrorScreen } from './parity-error-screen';
import { runParityLaunch } from './parity-launch';
import { describeParityError } from './parity-request';

import type { ParityAppliers } from './parity-launch';
import type { ParityPlanTable } from './parity-plans';
import type { ParityLaunchParams } from './parity-request';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

export type ParityLaunchRootProps = {
  /** The launch's search params, as useLocalSearchParams() returns them. */
  readonly params: ParityLaunchParams;
  readonly appliers: ParityAppliers;
  /** router.replace: the launch route never stays in the history. */
  readonly navigate: (href: Href) => void;
  /** The plan table (default PARITY_PLANS); tests pass their own. */
  readonly plans?: ParityPlanTable;
};

export function ParityLaunchRoot({
  params,
  appliers,
  navigate,
  plans,
}: ParityLaunchRootProps): ReactNode {
  const [failure, setFailure] = useState<string | null>(null);
  // The launch runs once per mount; every effect run (development runs effects twice) listens to the
  // same run, and its cleanup marks only its own listener stale.
  const launch = useRef<ReturnType<typeof runParityLaunch> | null>(null);
  useEffect(() => {
    let isActive = true;
    const deps = plans === undefined ? { appliers, navigate } : { appliers, navigate, plans };
    launch.current ??= runParityLaunch(params, deps);
    launch.current.then(
      (result) => {
        if (isActive && !result.ok) setFailure(describeParityError(result.error));
      },
      () => {
        // A crashed applier: the screen names the step kind only, never raw error text.
        if (isActive) setFailure('parity-launch-crashed');
      },
    );
    return () => {
      isActive = false;
    };
  }, [params, appliers, navigate, plans]);
  return failure === null ? null : <ParityErrorScreen message={failure} />;
}
