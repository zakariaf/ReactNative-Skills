// src/config/environment.ts (example: the app's one reader of public values, with the API base URL)
// app-variants-and-environment owns the pattern: each EXPO_PUBLIC_* variable named literally with dot
// access (the only form Metro inlines), declared in src/env.d.ts, checked once at startup. This
// skill adds the API base URL, checked by parseApiBaseUrl (https outside development).
//
// src/env.d.ts gains, next to EXPO_PUBLIC_APP_VARIANT:
//   /** Base URL of the app's API for this variant (set per EAS environment). */
//   readonly EXPO_PUBLIC_API_URL?: string;
// and each EAS environment gets a plain-text value (the developer runs these; stop and ask first):
//   eas env:set --name EXPO_PUBLIC_API_URL --value <url> --environment preview --visibility plaintext
import { parseApiBaseUrl } from './api-base-url';
import { currentAppVariant } from './current-app-variant';

import type { AppVariant } from './app-variant';

export type PublicEnvironment = {
  readonly variant: AppVariant;
  /** No trailing slash; requests add '/tasks' and so on. */
  readonly apiBaseUrl: string;
};

/** Reads and checks the public environment once (the composition root calls it). Throws when invalid. */
export function readPublicEnvironment(): PublicEnvironment {
  const variant = currentAppVariant();
  return Object.freeze({
    variant,
    apiBaseUrl: parseApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, variant),
  });
}
