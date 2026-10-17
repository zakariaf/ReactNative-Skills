// src/config/app-variant.ts: Expo inlines only EXPO_PUBLIC_* variables read with dot access.
export const APP_VARIANTS = ['development', 'preview', 'production'] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

export function readAppVariant(): AppVariant {
  return APP_VARIANTS.find((variant) => variant === process.env.EXPO_PUBLIC_APP_VARIANT) ?? 'development';
}
