// scripts/metro/public-env-cache-version.test.ts
import { publicEnvCacheVersion } from './public-env-cache-version.ts';

const DEVELOPMENT = { APP_VARIANT: 'development', EXPO_PUBLIC_APP_VARIANT: 'development' };
const PRODUCTION = { APP_VARIANT: 'production', EXPO_PUBLIC_APP_VARIANT: 'production' };

describe('publicEnvCacheVersion', () => {
  it('returns a short version string', () => {
    expect(publicEnvCacheVersion(DEVELOPMENT)).toMatch(/^public-env-[0-9a-f]{16}$/u);
  });

  it('changes when the variant changes', () => {
    expect(publicEnvCacheVersion(PRODUCTION)).not.toBe(publicEnvCacheVersion(DEVELOPMENT));
  });

  it('changes when any other public value changes', () => {
    const before = { ...PRODUCTION, EXPO_PUBLIC_API_HOST: 'api-1' };
    const after = { ...PRODUCTION, EXPO_PUBLIC_API_HOST: 'api-2' };
    expect(publicEnvCacheVersion(after)).not.toBe(publicEnvCacheVersion(before));
  });

  it('ignores variables that never reach the bundle', () => {
    const noisy = { ...PRODUCTION, APP_VARIANT: 'preview', HOME: '/tmp', SENTRY_AUTH_TOKEN: 'x' };
    expect(publicEnvCacheVersion(noisy)).toBe(publicEnvCacheVersion(PRODUCTION));
  });

  it('ignores the order of the variables', () => {
    const reordered = { EXPO_PUBLIC_B: '2', EXPO_PUBLIC_A: '1' };
    expect(publicEnvCacheVersion(reordered)).toBe(
      publicEnvCacheVersion({ EXPO_PUBLIC_A: '1', EXPO_PUBLIC_B: '2' }),
    );
  });

  it('treats an unset variable like a missing one', () => {
    expect(publicEnvCacheVersion({ ...PRODUCTION, EXPO_PUBLIC_API_HOST: undefined })).toBe(
      publicEnvCacheVersion(PRODUCTION),
    );
  });
});
