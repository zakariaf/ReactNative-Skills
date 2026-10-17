// src/test-only.ts
export const testOnly =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require('./test-only-entry');
