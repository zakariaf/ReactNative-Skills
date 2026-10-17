// src/config/environment.ts
export type PublicEnvironment = { readonly apiUrl: string };

export function readPublicEnvironment(): PublicEnvironment {
  return { apiUrl: process.env.EXPO_PUBLIC_TASKS_API_URL ?? '' };
}
