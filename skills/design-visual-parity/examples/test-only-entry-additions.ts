// Shape, not a template: the lines this skill adds to debug-menu-and-test-hooks'
// src/test-only-entry.ts (re-exports only; src/features/parity/ is in contracts/architecture.json
// testOnlyFolders). check-harness.mjs requires createParityKit here (harness-not-exported), read and
// called through TEST_ONLY by the app's root-kit registry, and ParityLaunchRoot rendered by a
// test-only screen (harness-not-wired).
export { createParityKit } from '@/features/parity/parity-root-kit';
// The app's wrapper that builds the appliers (examples/parity-launch-screen.tsx).
export { ParityLaunchScreen } from '@/features/debug/parity-launch-screen';
