// src/features/debug/test-hooks-root.tsx: the test build's one wrapper around the navigator. The
// debug kit (debug-root-kit.tsx) renders it in the root stack's motion slot, in MotionConfig's place,
// when the registry made test hooks: it hands the hooks to the debug screens and lets the debug
// motion switch hold every animation still through the app's one MotionConfig.
import { DebugMotionConfig } from './debug-motion-config';
import { TestHooksProvider } from './test-hooks-context';

import type { TestHooks } from '@/services/test-hooks/create-test-hooks';
import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';
import type { ReactNode } from 'react';

export type TestHooksRootProps = {
  readonly hooks: TestHooks;
  /** The app's reduce-motion preference, as MotionConfig would get it. */
  readonly preference: ReduceMotionPreference;
  readonly children: ReactNode;
};

export function TestHooksRoot({ hooks, preference, children }: TestHooksRootProps): ReactNode {
  return (
    <TestHooksProvider hooks={hooks}>
      <DebugMotionConfig preference={preference}>{children}</DebugMotionConfig>
    </TestHooksProvider>
  );
}
