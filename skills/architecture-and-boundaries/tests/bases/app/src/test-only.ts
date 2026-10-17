// The ONLY file allowed to require() test-only code: the inline literal comparison with 'production'
// lets Metro drop the entry from every store build.
import type { TestOnlyApi } from './test-only-api';

export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
