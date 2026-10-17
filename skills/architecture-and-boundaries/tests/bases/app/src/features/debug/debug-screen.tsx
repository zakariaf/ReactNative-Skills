// Test-only: reached only through TEST_ONLY (src/test-only.ts).
import { AppText } from '@/ui/app-text';

import { useDebugModel } from './use-debug-model';

export function DebugScreen() {
  const { label } = useDebugModel();
  return <AppText>{label}</AppText>;
}
