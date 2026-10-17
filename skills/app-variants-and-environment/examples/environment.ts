// src/config/environment.ts (an example shape for the Tasks app: imitate it, do not copy it)
// The one reader of public values other than the variant. Each variable is named literally with dot
// access (the only form Metro inlines), declared in src/env.d.ts, validated once, and frozen. Every
// value here ships inside the app: nothing secret ever appears in this file.
import * as v from 'valibot';

// The crash reporter's DSN (EXPO_PUBLIC_CRASH_REPORTER_DSN) is not read here: crash-reporting-and-
// observability's parseCrashReportingConfig(raw, variant) owns that rule (malformed throws, empty
// throws in production, development never reports) and adds it as its own config reader.

import { currentAppVariant } from './current-app-variant';

import type { AppVariant } from './app-variant';

const publicEnvironmentSchema = v.object({
  /** Base URL of the Tasks API for this variant (set per EAS environment). */
  tasksApiUrl: v.pipe(v.string(), v.url()),
});

export type PublicEnvironment = v.InferOutput<typeof publicEnvironmentSchema> & {
  readonly variant: AppVariant;
};

/**
 * Reads and checks the public environment once at startup (the composition root calls it). A missing
 * or malformed value throws with the variable's name, so a build made without its EAS environment
 * fails on first launch in testing instead of calling `undefined/tasks` in the field.
 */
export function readPublicEnvironment(): PublicEnvironment {
  const parsed = v.safeParse(publicEnvironmentSchema, {
    tasksApiUrl: process.env.EXPO_PUBLIC_TASKS_API_URL,
  });
  if (!parsed.success) {
    const fields = parsed.issues.map((issue) => v.getDotPath(issue) ?? 'environment').join(', ');
    throw new Error(
      `Invalid public environment (${fields}): check the EXPO_PUBLIC_* variables of this build`,
    );
  }
  return Object.freeze({ ...parsed.output, variant: currentAppVariant() });
}

// src/env.d.ts gains, next to EXPO_PUBLIC_APP_VARIANT:
//   readonly EXPO_PUBLIC_TASKS_API_URL?: string;
// and each EAS environment gets plain-text values:
//   eas env:set --name EXPO_PUBLIC_TASKS_API_URL --value <url> --environment preview --visibility plaintext
