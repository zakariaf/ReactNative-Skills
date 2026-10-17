// src/config/api-base-url.ts
// Checks the API base URL once, at startup. The value comes from EXPO_PUBLIC_API_URL (set per EAS
// environment, so each variant talks to its own server), read with dot access in the app's
// environment reader (app-variants-and-environment) and passed here. Release builds refuse cleartext
// on both platforms (iOS App Transport Security; Android 9+ usesCleartextTraffic=false outside debug
// builds), so only the development variant may use http:// (a dev server on the LAN or 10.0.2.2).
import type { AppVariant } from './app-variant';

const HTTPS = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/u;
const HTTP = /^http:\/\/[^\s/?#]+(\/[^\s?#]*)?$/u;

/**
 * The base URL without a trailing slash. Throws with the variable's name when it is missing, not an
 * absolute http(s) URL, carries a query or fragment, or is http:// outside development: a build made
 * without its EAS environment then fails on the first launch in testing, not in the field.
 */
export function parseApiBaseUrl(raw: string | undefined, variant: AppVariant): string {
  const value = raw?.trim() ?? '';
  if (value === '') {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set: set it in the EAS environment of this variant',
    );
  }
  const isHttps = HTTPS.test(value);
  if (!isHttps && !(variant === 'development' && HTTP.test(value))) {
    throw new Error(
      `EXPO_PUBLIC_API_URL must be an https:// URL without query or fragment (http:// only in development), got "${value}"`,
    );
  }
  return value.replace(/\/+$/u, '');
}
