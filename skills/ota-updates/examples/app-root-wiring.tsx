// Example: where the foreground checks start (app-startup-and-bootstrap owns app-root.tsx). The
// hook runs in the tree that renders only after the splash release, so the check is deferred work:
// it never holds the splash, and the native launch check (ON_LOAD) has already run.
import { useServices } from '@/services/services-context';
import { useUpdateChecks } from '@/hooks/use-update-checks';

import type { JSX, ReactNode } from 'react';

export function AfterSplash({ children }: { readonly children: ReactNode }): JSX.Element {
  const { updateChecker } = useServices();
  useUpdateChecks(updateChecker);
  return <>{children}</>;
}
