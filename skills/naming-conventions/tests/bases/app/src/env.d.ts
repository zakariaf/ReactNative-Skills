// src/env.d.ts: every EXPO_PUBLIC_* variable the app reads.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_APP_VARIANT?: 'development' | 'preview' | 'production';
  }
}
