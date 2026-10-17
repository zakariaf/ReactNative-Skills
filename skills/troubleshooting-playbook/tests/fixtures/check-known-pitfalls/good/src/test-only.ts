// src/test-only.ts
import type * as TestOnlyEntry from './test-only-entry';

export type TestOnlyApi = typeof TestOnlyEntry;

export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
