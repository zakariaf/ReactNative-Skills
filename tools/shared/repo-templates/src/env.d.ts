// src/env.d.ts
// Every EXPO_PUBLIC_* variable the app reads, typed for dot access (both TypeScript programs read
// this file; src/app-env.d.ts declares `process` itself). Metro inlines each value into the JS bundle
// at build time, so everything declared here is public: anyone with the app can read it. A secret
// never gets an EXPO_PUBLIC_ name; it stays an EAS secret or a CI secret and never reaches the app.
declare namespace NodeJS {
  interface ProcessEnv {
    /** development | preview | production: exported with APP_VARIANT for every build. */
    readonly EXPO_PUBLIC_APP_VARIANT?: string;
  }
}
