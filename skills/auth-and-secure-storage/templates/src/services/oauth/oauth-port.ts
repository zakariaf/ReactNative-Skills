// src/services/oauth/oauth-port.ts
// Signing in with an OAuth 2.0 / OpenID Connect provider: the authorization-code flow with PKCE in
// the system browser (ASWebAuthenticationSession on iOS, a Custom Tab on Android), the refresh grant
// and token revocation. It also satisfies the session's TokenRefresher. Adapter:
// auth-session-oauth-adapter.ts (expo-auth-session). Fake: fake-oauth.ts.
import type { Result } from '@/core/result';
import type { RefreshFailure, TokenGrant } from '@/core/session/token-set';

/** The provider, per build (src/config reads it from EXPO_PUBLIC_* variables). */
export type OauthConfig = {
  /** The provider's issuer (https); its discovery document names the endpoints. */
  readonly issuer: string;
  /** The app's public client id at the provider (no client secret: PKCE proves the app). */
  readonly clientId: string;
  /** The app's URL scheme for this variant (app.config.ts `scheme`); the provider allows its redirect. */
  readonly scheme: string;
  readonly scopes: readonly string[];
};

/** Why sign-in produced no tokens. */
export type OauthFailure =
  /** The person closed the browser or the app dismissed it: show nothing. */
  | { readonly kind: 'cancelled' }
  /** The provider answered with an error (access_denied, state_mismatch, invalid_scope, ...). */
  | { readonly kind: 'denied'; readonly code: string }
  | { readonly kind: 'network-unavailable' }
  | { readonly kind: 'timed-out'; readonly afterMs: number }
  | { readonly kind: 'server-unavailable' };

/** Never rejects: every outcome is a Result. */
export type OauthPort = {
  /** Opens the provider's sign-in page and exchanges the returned code (with its PKCE verifier). */
  readonly signIn: () => Promise<Result<TokenGrant, OauthFailure>>;
  readonly refresh: (refreshToken: string) => Promise<Result<TokenGrant, RefreshFailure>>;
  /** Asks the provider to forget the refresh token (RFC 7009); best effort at sign-out. */
  readonly revoke: (refreshToken: string) => Promise<Result<void, OauthFailure>>;
};
