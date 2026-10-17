// src/config/current-app-variant.ts
// The variant this JS bundle was built for: the one place app code learns it. Metro inlines
// process.env.EXPO_PUBLIC_APP_VARIANT at build time (dot access only). Behaviour may depend on the
// result (a Preview badge, which API environment to call); whether test-only code is in the bundle
// may not: that needs the literal comparison inside the test-only gate, because Metro cannot strip a
// require() behind a function call or an imported constant.
import { parseAppVariant } from './app-variant';

import type { AppVariant } from './app-variant';

/** The variant of this bundle; development when unset (a local `expo start` without variables). */
export function currentAppVariant(): AppVariant {
  return parseAppVariant(process.env.EXPO_PUBLIC_APP_VARIANT ?? 'development');
}
