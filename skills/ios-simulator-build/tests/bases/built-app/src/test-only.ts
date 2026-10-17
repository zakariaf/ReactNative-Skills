// src/test-only.ts
import type { TestOnlyApi } from './test-only-entry';

export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
