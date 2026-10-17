// src/hooks/use-screen-views.ts
// Reports each screen the user reaches, by route pattern only (screen-name.ts). The caller passes
// what to do with the name (the root stack sends a screen_view event through the AnalyticsPort), so
// this hook reads no service and is tested with a plain function.
import { useSegments } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';

import { screenNameFromSegments } from '@/services/analytics/screen-name';

/** Calls `onScreen` once per screen change with the route pattern ('tasks/[id]'). */
export function useScreenViews(onScreen: (screen: string) => void): void {
  const screen = screenNameFromSegments(useSegments());
  const report = useEffectEvent((name: string) => {
    onScreen(name);
  });
  useEffect(() => {
    report(screen);
  }, [screen]);
}
