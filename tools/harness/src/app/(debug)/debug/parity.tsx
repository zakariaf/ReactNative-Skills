// src/app/(debug)/debug/parity.tsx: the parity launch route (design-visual-parity), /debug/parity.
// Expo Router opens it for the Android link <scheme>://debug/parity?<query> and for the iOS launch
// bridge (the parity kit's effect). It lives in the (debug) group, which AppStack keeps behind
// Stack.Protected until the test build's debug kit opens it; in a production build TEST_ONLY is null
// and it redirects home. Thin: it hands the search params to the test-only launch screen.
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { TEST_ONLY } from '@/test-only';

export default function ParityLaunchRoute(): React.JSX.Element {
  const params = useLocalSearchParams();
  const ParityLaunchScreen = TEST_ONLY?.ParityLaunchScreen;
  if (ParityLaunchScreen === undefined) return <Redirect href="/" />;
  return (
    <ParityLaunchScreen
      params={params}
      // replace: Back never returns to the launch route.
      navigate={(href) => {
        router.replace(href);
      }}
    />
  );
}
