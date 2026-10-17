// src/app/(debug)/debug/setup.tsx: the debug deep link, <scheme>://debug/setup?<param>=<value>&...
// Expo Router opens it like any route, on a cold start and while running, and holds it until the
// navigator is ready. Thin: it hands the search params to the test-only screen through the gate.
import { Redirect, useLocalSearchParams } from 'expo-router';

import { TEST_ONLY } from '@/test-only';

export default function DebugSetupRoute(): React.JSX.Element {
  const params = useLocalSearchParams();
  const DebugSetup = TEST_ONLY?.DebugSetupRoot;
  return DebugSetup === undefined ? <Redirect href="/" /> : <DebugSetup params={params} />;
}
