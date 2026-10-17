// Neutral: read by Node (app.config.ts) and by the app. Imports nothing.
export const APP_VARIANTS = ['development', 'preview', 'production'] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

export function resolveAppVariant(raw: string | undefined): AppVariant {
  const match = APP_VARIANTS.find((variant) => variant === raw);
  return match ?? 'development';
}
