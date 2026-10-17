// scripts/metro/public-env-cache-version.ts
export function publicEnvCacheVersion(env: Record<string, string | undefined>): string {
  return Object.keys(env).filter((key) => key.startsWith('EXPO_PUBLIC_')).sort().map((key) => `${key}=${env[key] ?? ''}`).join('&');
}
