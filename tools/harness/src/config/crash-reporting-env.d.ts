// src/config/crash-reporting-env.d.ts
// The crash reporter's one public variable, typed for dot access in both TypeScript programs (it
// merges into src/env.d.ts's ProcessEnv; an app may move the line there instead). Public by design:
// a DSN only lets a client send events. The upload token is never an EXPO_PUBLIC_ variable.
declare namespace NodeJS {
  interface ProcessEnv {
    /** https://<key>@<host>/<project-id> per reporting EAS environment; empty: no reports. */
    readonly EXPO_PUBLIC_CRASH_REPORTER_DSN?: string;
  }
}
