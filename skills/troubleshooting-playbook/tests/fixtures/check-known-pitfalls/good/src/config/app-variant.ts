// src/config/app-variant.ts
export type AppVariant = 'development' | 'preview' | 'production';

export function resolveAppVariant(env: Record<string, string | undefined>): AppVariant {
  const value = env['APP_VARIANT'];
  return value === 'production' || value === 'preview' ? value : 'development';
}
