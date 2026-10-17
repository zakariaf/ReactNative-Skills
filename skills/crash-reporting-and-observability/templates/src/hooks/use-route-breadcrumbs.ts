// src/hooks/use-route-breadcrumbs.ts
// One navigation breadcrumb per route change, so a crash report shows the screens the person came
// through. The breadcrumb names the route pattern from useSegments() ('(app)/tasks/[id]'), never the
// pathname or the params ('/tasks/42', '?q=...'): ids and search text are content, not diagnosis.
import { useSegments } from 'expo-router';
import { useEffect } from 'react';

import type { CrashReporterPort } from '@/services/crash-reporter/crash-reporter-port';

/** Records the current route pattern on every change; call once, in the top layout. */
export function useRouteBreadcrumbs(crashReporter: Pick<CrashReporterPort, 'addBreadcrumb'>): void {
  const joined = useSegments().join('/');
  const route = joined === '' ? '/' : joined;
  useEffect(() => {
    crashReporter.addBreadcrumb({ category: 'navigation', message: route });
  }, [crashReporter, route]);
}
