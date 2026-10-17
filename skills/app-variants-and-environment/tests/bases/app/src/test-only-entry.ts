// src/test-only-entry.ts
export type TestOnlyApi = { readonly recordScreen: (name: string) => void };

export function recordScreen(name: string): void {
  void name;
}

export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY';
