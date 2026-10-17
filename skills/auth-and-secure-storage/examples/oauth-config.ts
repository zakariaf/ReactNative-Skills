// src/config/oauth-config.ts
// The OAuth provider of this build, read once from EXPO_PUBLIC_* variables set per EAS environment
// (development, preview and production each register their own redirect with the provider). An
// issuer and a client id are public by design: they ship in every OAuth app. A client secret never
// does: the app is a public client and proves itself with PKCE.
import Constants from 'expo-constants';

import type { OauthConfig } from '@/services/oauth/oauth-port';

/** openid for the id token, offline_access for a refresh token (provider-specific; check yours). */
export const OAUTH_SCOPES: readonly string[] = ['openid', 'profile', 'email', 'offline_access'];

/** Throws at startup with the variable's name: a build without its provider must not ship. */
function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set for this build (set it in the EAS environment)`);
  }
  return value;
}

/** The URL scheme this build registered (app.config.ts gives each variant its own). */
function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  const first = Array.isArray(scheme) ? scheme[0] : scheme;
  if (first === undefined)
    throw new Error('app.config.ts sets no scheme: OAuth redirects need one');
  return first;
}

/** The provider settings of this build. */
export function readOauthConfig(): OauthConfig {
  const issuer = required('EXPO_PUBLIC_OAUTH_ISSUER', process.env.EXPO_PUBLIC_OAUTH_ISSUER);
  if (!issuer.startsWith('https://')) {
    throw new Error('EXPO_PUBLIC_OAUTH_ISSUER must be an https:// URL');
  }
  const clientId = required('EXPO_PUBLIC_OAUTH_CLIENT_ID', process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID);
  return { issuer, clientId, scheme: appScheme(), scopes: OAUTH_SCOPES };
}
