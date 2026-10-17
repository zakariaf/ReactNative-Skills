// src/features/debug/test-build.ts
export const isTestBuild = process.env.EXPO_PUBLIC_APP_VARIANT !== 'production';
