// src/test-only.ts
// The test-only gate: the one way into code that development and preview builds carry and production
// builds must not (the debug menu, the debug deep link, the simulated clock and connectivity). Metro
// inlines EXPO_PUBLIC_APP_VARIANT, folds this literal comparison and only then collects require()
// calls, so a production bundle never contains the entry or anything only it imports. Keep the
// expression exactly as written: an imported constant, a helper call, __DEV__ or an if block keeps the
// module in production (app-variants-and-environment owns that rule and the bundle proof). This is the
// one file ESLint lets call require() for code. Callers read TEST_ONLY?.member and treat null as
// "production: do nothing".
import type * as TestOnlyEntry from './test-only-entry';

/**
 * Everything the entry exports, typed from the entry itself: TypeScript compares the two for you, and
 * knip sees every export of the entry as used (a hand-written type made knip report them).
 */
export type TestOnlyApi = typeof TestOnlyEntry;

/** The test-only kit, or null in a production bundle. */
export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
