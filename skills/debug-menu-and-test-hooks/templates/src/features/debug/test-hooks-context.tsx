// src/features/debug/test-hooks-context.tsx
// Hands the test hooks (createTestHooks' result) down to the debug screens in a test build. The
// object never changes after startup (context carries the dependency; zustand carries the changing
// state), so nothing re-renders for the provider itself. TestHooksRoot renders this provider; the
// debug kit (debug-root-kit.tsx) puts TestHooksRoot in the root's motion slot only in a test build,
// and production has neither.
import { createContext, use } from 'react';

import { DebugOverridesStoreContext } from '@/stores/debug-overrides/debug-overrides-store';

import type { TestHooks } from '@/services/test-hooks/create-test-hooks';
import type { ReactNode } from 'react';

const TestHooksContext = createContext<TestHooks | null>(null);

export type TestHooksProviderProps = {
  readonly hooks: TestHooks;
  readonly children: ReactNode;
};

export function TestHooksProvider({ hooks, children }: TestHooksProviderProps): ReactNode {
  return (
    <TestHooksContext value={hooks}>
      <DebugOverridesStoreContext value={hooks.overrides}>{children}</DebugOverridesStoreContext>
    </TestHooksContext>
  );
}

/** The hooks; a test screen without the provider is a wiring mistake, so it throws. */
export function useTestHooks(): TestHooks {
  const hooks = use(TestHooksContext);
  if (hooks === null) {
    throw new Error(
      'useTestHooks() needs a <TestHooksProvider> above it (wire it in the app root)',
    );
  }
  return hooks;
}
