// src/test-only-entry.ts
/** @public */
export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY';
export type TestOnlyApi = { readonly TEST_BUILD_SENTINEL: string };
