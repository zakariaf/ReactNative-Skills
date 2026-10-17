// Shape, not a template: the parity kit's lines in the app's root-kit registry
// (src/services/create-root-kits.ts, app-startup-and-bootstrap's template; debug-menu-and-test-hooks'
// examples/create-root-kits.ts adds the debug kit the same way). The canonical root skeleton stays
// unchanged: the kit's provide slot wraps the Stack in ParityFrameRoot (the frame request and the
// launch marker) and its effects slot mounts ParityLaunchBridge beside the Stack (iOS's -parity launch
// argument -> the launch route, with router.replace). TEST_ONLY is null in a production build, so the
// list is empty there and none of the harness ships.
import { TEST_ONLY } from '@/test-only';

import type { RootKit } from '@/services/root-kits/root-kit';

/** The test build's kits; none in production. */
function testBuildKits(): readonly RootKit[] {
  const createParityKit = TEST_ONLY?.createParityKit;
  return createParityKit === undefined ? [] : [createParityKit()];
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits(): readonly RootKit[] {
  return [
    // ...the app's other kits (crash reporting, analytics, notifications)
    ...testBuildKits(),
  ];
}
