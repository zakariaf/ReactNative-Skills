// src/features/root-navigator/debug-route.tsx (React Navigation static API): the Debug group's screen.
// The debug screen is reached only through TEST_ONLY, whose literal variant check lets Metro drop it
// from production bundles (debug-menu-and-test-hooks owns the gate).
import { TEST_ONLY } from '@/features/debug/test-only';

import type { ReactNode } from 'react';

export function DebugRoute(): ReactNode {
  if (TEST_ONLY === null) return null;
  return <TEST_ONLY.DebugScreen />;
}
