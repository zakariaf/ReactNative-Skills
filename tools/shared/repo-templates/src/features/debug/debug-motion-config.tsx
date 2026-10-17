// src/features/debug/debug-motion-config.tsx: MotionConfig with the debug switch on top (inside
// TestHooksRoot). While the switch says still (motion=still: screenshots and E2E), it passes 'on'
// instead of the app's preference, so every animation rests at its end state through the one
// reduce-motion path, never a second switch.
import { selectIsMotionStill } from '@/stores/debug-overrides/debug-overrides-selectors';
import { useDebugOverridesStore } from '@/stores/debug-overrides/debug-overrides-store';
import { MotionConfig } from '@/ui/a11y/motion-config';

import type { MotionConfigProps } from '@/ui/a11y/motion-config';
import type { ReactNode } from 'react';

export function DebugMotionConfig({ preference, children }: MotionConfigProps): ReactNode {
  const isStill = useDebugOverridesStore(selectIsMotionStill);
  return <MotionConfig preference={isStill ? 'on' : preference}>{children}</MotionConfig>;
}
