// src/services/create-root-kits.ts
import { TEST_ONLY } from '@/test-only';

import type { RootKit } from '@/services/root-kits/root-kit';

/** The test build's kits: the parity kit (none in production, where TEST_ONLY is null). */
function testBuildKits(): readonly RootKit[] {
  const createParityKit = TEST_ONLY?.createParityKit;
  return createParityKit === undefined ? [] : [createParityKit()];
}

export function createRootKits(): readonly RootKit[] {
  return [...testBuildKits()];
}
