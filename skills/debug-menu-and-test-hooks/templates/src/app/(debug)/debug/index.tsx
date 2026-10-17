// src/app/(debug)/debug/index.tsx: the debug menu, /debug. Thin: it renders the test-only screen
// through the gate and goes home when the bundle has none (production).
import { Redirect } from 'expo-router';

import { TEST_ONLY } from '@/test-only';

export default function DebugMenuRoute(): React.JSX.Element {
  const DebugMenu = TEST_ONLY?.DebugMenuRoot;
  return DebugMenu === undefined ? <Redirect href="/" /> : <DebugMenu />;
}
