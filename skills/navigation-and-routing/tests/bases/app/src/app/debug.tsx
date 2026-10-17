// src/app/debug.tsx: test builds only; TEST_ONLY is null in production, so Metro drops the debug screen.
import { TEST_ONLY } from '@/features/debug/test-only';

export default function DebugRoute(): React.JSX.Element | null {
  return TEST_ONLY === null ? null : <TEST_ONLY.DebugScreen />;
}
