// src/features/debug/debug-root-kit.tsx
// The test build's root kit (debug-menu-and-test-hooks): one entry of the app's registry
// (src/services/create-root-kits.ts), reached only through the test-only gate as
// TEST_ONLY?.createDebugKit, so a production build holds neither the kit nor anything it renders.
// The registry's prepareRootKits already swapped the simulated clock and network into the services
// (TEST_ONLY?.createTestHooks); the hooks it made arrive here and fill two root slots: motion, where
// TestHooksRoot takes MotionConfig's place (the hooks for the debug screens, and the debug motion
// switch through the app's one MotionConfig), and opensDebugRoutes, which opens the (debug) route
// group that AppStack keeps behind Stack.Protected.
import { TestHooksRoot } from './test-hooks-root';

import type { RootKit } from '@/services/root-kits/root-kit';
import type { TestHooks } from '@/services/test-hooks/create-test-hooks';

/** The test build's kit over the hooks prepareRootKits created. */
export function createDebugKit(hooks: TestHooks): RootKit {
  return {
    name: 'debug',
    motion: ({ preference, children }) => (
      <TestHooksRoot hooks={hooks} preference={preference}>
        {children}
      </TestHooksRoot>
    ),
    opensDebugRoutes: true,
  };
}
