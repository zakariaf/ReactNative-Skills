// Shape, not a template: src/app/(debug)/debug/parity.tsx, the parity launch route.
// Expo Router opens it for the Android link <scheme>://debug/parity?<query> and for the iOS launch
// bridge (TEST_ONLY.ParityLaunchBridge). It lives in debug-menu-and-test-hooks' (debug) group, whose
// layout puts it inside Stack.Protected; in a production build TEST_ONLY is null and it redirects home.
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { TEST_ONLY } from '@/test-only';

import type { ReactNode } from 'react';

export default function ParityLaunchRoute(): ReactNode {
  const params = useLocalSearchParams();
  const ParityLaunchScreen = TEST_ONLY?.ParityLaunchScreen;
  if (ParityLaunchScreen === undefined) return <Redirect href="/" />;
  return (
    <ParityLaunchScreen
      params={params}
      // replace: Back never returns to the launch route. The plans' hrefs are typed (Href), so
      // no cast: a renamed route fails tsc in parity-plans.ts.
      navigate={(href) => {
        router.replace(href);
      }}
    />
  );
}
