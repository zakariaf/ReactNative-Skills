// src/app-env.d.ts: read by the app program only (src/tsconfig.json); the root tsconfig.json excludes
// it. App code loads no @types/node, so `process` (which Expo inlines for EXPO_PUBLIC_* variables
// read with dot access) is declared here. Declare each EXPO_PUBLIC_* variable in src/env.d.ts, which
// both programs read; declared here only, the root program fails with TS4111 on dot access.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: 'development' | 'production' | 'test';
  }
}
declare const process: { readonly env: NodeJS.ProcessEnv };
