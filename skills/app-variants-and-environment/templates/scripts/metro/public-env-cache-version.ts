// scripts/metro/public-env-cache-version.ts
// Metro's cacheVersion for this build: a hash of every EXPO_PUBLIC_* name and value. Metro inlines
// those values into production transforms but does not key its cache on them (metro.config.js says
// why), so a change of variant or of any public value must start from a fresh cache key.
import { createHash } from 'node:crypto';

export const PUBLIC_ENV_PREFIX = 'EXPO_PUBLIC_';

/** `public-env-<16 hex>` from the EXPO_PUBLIC_* entries of `env`; order and other names ignored. */
export function publicEnvCacheVersion(env: Readonly<Record<string, string | undefined>>): string {
  const lines = Object.entries(env)
    .filter(([name, value]) => name.startsWith(PUBLIC_ENV_PREFIX) && value !== undefined)
    .map(([name, value]) => `${name}=${value ?? ''}`)
    .sort();
  const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
  return `public-env-${digest.slice(0, 16)}`;
}
