# OAuth with PKCE, Sign in with Apple, and the store rules around sign-in

How the app signs someone in with an OAuth 2.0 / OpenID Connect provider through `expo-auth-session`,
how Sign in with Apple fits next to it, and what App Review and Google Play require. API facts
verified on 2026-10-10 against expo-auth-session 57.0.13, expo-web-browser 57.0.3,
expo-apple-authentication 57.0.2 and expo-crypto 57.0.3 (installed sources and the SDK 57 docs);
store rules read from Apple's App Review Guidelines and Google Play's policy page the same day.

## Contents

1. The flow and why it is the only one
2. expo-auth-session 57, call by call
3. Redirects, schemes and the Android redirect route
4. Errors, timeouts and what each one means
5. Tokens from the provider and the id token
6. Sign in with Apple
7. Store rules: login services and account deletion
8. Testing
9. The device checklist

## 1. The flow and why it is the only one

**Authorization code with PKCE (S256), in the system browser, with an ephemeral session.**

- **System browser, never a WebView.** `ASWebAuthenticationSession` on iOS and a Custom Tab on
  Android show the provider's real page with its address bar; the app never sees the password.
  Providers (Google among them) refuse embedded WebViews.
- **Code, never implicit.** The implicit flow returns tokens in the redirect URL, where any app that
  registered the same scheme, the browser history and logs can read them (`oauth-pkce`).
- **PKCE, never a client secret.** A secret in the binary is public. PKCE proves that the app that
  exchanges the code started the flow: it keeps a random `code_verifier`, sends its SHA-256
  (`code_challenge`) with the request and the verifier with the exchange. The app is registered as a
  public client.
- **Ephemeral session** (`preferEphemeralSession: true`, iOS): no cookie shared with Safari and no
  "wants to use ... to sign in" alert. After sign-out the provider asks again instead of signing the
  last person straight back in from the browser's cookie, which is what "logout clears everything"
  means on a shared phone (`oauth-ephemeral`). An app that deliberately wants single sign-on with the
  browser says why in `contracts/auth.json` `oauthSharedBrowserSession`. Android Custom Tabs have no
  ephemeral mode here; there the provider's own session cookie decides (offer the provider's sign-out
  URL in a browser when the app needs it).

## 2. expo-auth-session 57, call by call

| Step | Call | Notes |
|---|---|---|
| Endpoints | `fetchDiscoveryAsync(issuer)` | once per app run; a failed fetch is forgotten so the next sign-in tries again |
| Request | `new AuthRequest({ clientId, redirectUri, scopes, responseType: ResponseType.Code, usePKCE: true, codeChallengeMethod: CodeChallengeMethod.S256 })` | `state` is generated (10 random characters) and checked by `promptAsync`: a mismatch answers `{ type: 'error', params: { error: 'state_mismatch' } }` |
| Browser | `request.promptAsync(discovery, { preferEphemeralSession: true })` | result `type`: `success`, `error`, `cancel`, `dismiss`, `opened`, `locked` (another auth session is open) |
| Exchange | `exchangeCodeAsync({ clientId, redirectUri, code, extraParams: { code_verifier: request.codeVerifier } }, discovery)` | **the verifier is not added by the library**: without it the provider refuses the code (`oauth-pkce`) |
| Refresh | `refreshAsync({ clientId, refreshToken }, discovery)` | throws a `TokenError` with `code` for an OAuth error answer |
| Revoke | `revokeAsync({ clientId, token, tokenTypeHint: TokenTypeHint.RefreshToken }, discovery)` | RFC 7009; best effort at sign-out |
| Web only | `WebBrowser.maybeCompleteAuthSession()` | closes the popup on web; native apps do not need it |

The hooks (`useAuthRequest`, `useAutoDiscovery`) do the same inside a component. The adapter uses the
plain calls so the whole flow is one port method that tests drive with a fake and the adapter test
drives with Jest's automock.

The token calls take no abort signal, so the adapter races each against a 15 s deadline
(`withTimeout`, async-safety) and ignores an answer that arrives later. The request itself may still
reach the server: an abandoned refresh can rotate the refresh token there while the device keeps the
old one, and the next refresh then answers `invalid_grant` (a clean sign-out, never a wrong session).
Providers with refresh-token rotation usually offer a reuse grace period for exactly this; turn it on
when slow networks are common.

## 3. Redirects, schemes and the Android redirect route

- The redirect URI is `<scheme>://oauth-redirect`, built with
  `makeRedirectUri({ scheme, path: 'oauth-redirect' })` inside the adapter on the first sign-in (not
  when the services are created: under Jest and in some launch paths it reads the dev server's host).
- Each variant has its own scheme in `app.config.ts` (app-variants-and-environment), so register one
  redirect URI per variant with the provider. `src/config/oauth-config.ts` (example) reads the scheme
  from `Constants.expoConfig.scheme` and the issuer and client id from `EXPO_PUBLIC_OAUTH_ISSUER` and
  `EXPO_PUBLIC_OAUTH_CLIENT_ID`, set per EAS environment; a missing value or a non-https issuer throws
  at startup with the variable's name.
- Expo Go cannot test OAuth redirects (its scheme is not yours): use a development build.
- **Android delivers the redirect to Expo Router too.** The Custom Tab opens
  `<scheme>://oauth-redirect?code=...`, which reaches the app as a deep link while expo-web-browser
  reads it. Without a route at that path the not-found screen flashes. `src/app/oauth-redirect.tsx`
  (example) renders nothing and steps back (or redirects to `/`); the code itself is never read there.
  Verified by reading expo-web-browser's Android path; confirm it on a device.
- Changing the scheme needs a new native build (`npx expo prebuild --clean` under CNG).

**Google does not fit the generic redirect.** Read on Google's "OAuth 2.0 for iOS & Desktop Apps"
page on 2026-10-10 (re-verify there before building): "Custom URI schemes are no longer supported on
Android and Chrome apps", and an Android client that tries answers `invalid_request` ("Custom URI
scheme is not supported on Android or Chrome apps"). The iOS client's redirect is the reversed client
id (`com.googleusercontent.apps.<id>:/oauthredirect`), not `<scheme>://oauth-redirect`, and Google
recommends its Sign In With Google SDK on iOS and Android's identity APIs (Credential Manager) on
Android. The default for Google is therefore:

- **Through the app's server** (preferred when there is one): the app signs in with the server's own
  OpenID provider, which federates Google on the web (an https redirect Google accepts), and the
  app's redirect stays `<scheme>://oauth-redirect` toward the server's issuer.
- **Native Google sign-in**: a separate `GoogleSignInPort` whose adapter wraps the native SDK and
  returns an id token (and, with a server client id, a server auth code) for the app's server to
  verify, exactly like Sign in with Apple's credential; the session then stores the server's tokens.
  It needs its own config plugin and a development build. Not covered by this skill's templates.
- **expo-auth-session against Google directly** only on iOS, with the iOS client's reversed-client-id
  redirect registered as an extra scheme; never on Android.

Other providers (Auth0, Okta, Keycloak, Cognito, Azure AD B2C, an in-house issuer) accept the custom
scheme redirect for a native public client.

## 4. Errors, timeouts and what each one means

| Where | Outcome | Failure kind | UI |
|---|---|---|---|
| Browser | closed, dismissed, `locked` | `cancelled` | nothing |
| Browser | `{ type: 'error', params.error }` (`access_denied`, `state_mismatch`, ...) | `denied` + code | "sign-in did not work" |
| Exchange | an OAuth error code | `denied` + code | same |
| Exchange / refresh / discovery | no answer, TLS, a non-JSON body | `network-unavailable` | offline message (ui-states-and-feedback) |
| Exchange / refresh | `temporarily_unavailable`, `server_error` | `server-unavailable` | try again later |
| Any token call | past 15 s | `timed-out` | try again |
| Refresh | past 15 s, but the server answered later and rotated | `timed-out` now; `invalid-grant` at the next refresh | the session ends cleanly at the next refresh, unless the server accepts the previous refresh token for a short grace period |
| Refresh | `invalid_grant` | `invalid-grant` | the session ends (session-lifecycle.md section 5) |
| Refresh | any other OAuth code | `rejected` + code | the session ends, recorded |

The error code is read from the thrown error's `code`, never from its message text.

## 5. Tokens from the provider and the id token

- `TokenResponse` gives `accessToken`, `refreshToken?`, `expiresIn?` (seconds), `idToken?`. The adapter
  passes only the fields the server sent (`exactOptionalPropertyTypes`).
- Ask for `offline_access` (or the provider's equivalent) to receive a refresh token; without one the
  session ends when the access token does.
- `readIdTokenClaims(idToken)` (template, `src/core/session/id-token-claims.ts`) decodes the JWT payload
  without verifying it, for display: `sub`, `name`, `email`. It is never used for an authorization
  decision; the server verifies every token it receives. The id token itself is not stored.
- When the app has its own API, the server's own session tokens are the rule, not a preference: the
  app sends the provider's id token to `POST /auth/oauth` (`exchangeOauthIdToken`), the server verifies
  it and answers with its own tokens, and the app stores only those. The provider's tokens never live
  on the phone, and the session's one `TokenRefresher` is the server's (`createServerTokenRefresher`).
  Mixing issuers in one session (OAuth tokens from one method, server tokens from Apple) sends one
  issuer's refresh token to the other and signs the person out (session-lifecycle section 3).
- Without a server (OAuth is then the only method), the OAuth grant goes straight to
  `session.signIn` and the OAuth adapter is the refresher.

## 6. Sign in with Apple

| | |
|---|---|
| Platforms | iOS only (`isAvailableAsync()` is false on Android and web). On Android, offer Apple's web flow through the OAuth adapter (Apple as an OpenID provider, redirect to your server) or skip it there. |
| Config | `ios.usesAppleSignIn: true` or the `'expo-apple-authentication'` plugin: it adds the `com.apple.developer.applesignin` entitlement (`apple-sign-in`). EAS Build enables the capability on the App ID when it syncs capabilities; the local lane enables it in the developer portal by hand. |
| The sheet | `signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`; closing it rejects with `ERR_REQUEST_CANCELED`, which is silent (`apple-sign-in`). The JS layer refuses an answer without `identityToken`, `authorizationCode` or `user` (`ERR_REQUEST_FAILED`). |
| Nonce | a fresh random value per attempt (`randomUUID` from expo-crypto); its SHA-256 (`digestStringAsync`) goes to Apple, which signs it into the identity token's `nonce` claim; the raw value goes to the server, which hashes and compares. A captured identity token cannot be replayed (`apple-sign-in`). |
| What the server does | verifies the identity token with Apple's public keys (issuer `https://appleid.apple.com`, `aud` = the bundle id, `nonce`, expiry), exchanges `authorizationCode` at Apple for Apple's refresh token (needed to revoke at account deletion), stores the name and email, and answers with the app's own tokens |
| Name and email | sent **only on the first sign-in** for this Apple ID and app; later sign-ins answer `null`. The server must save them at once. The email may be a private relay address. |
| Revocation | check `getCredentialStateAsync(user)` at launch for a person who signed in with Apple (`revoked` → sign out); `addRevokeListener` fires when the person stops using Apple ID with the app in Settings while it runs |
| Button | Apple's own `AppleAuthenticationButton` (approved, localized, accessible). It travels through the port (`appleSignIn.Button`) because only the adapter may import the SDK (architecture-and-boundaries); black on light screens, white on dark, at least 44 high. Render it only when `isAvailable()` is true. |
| Sign-out | do not call `signOutAsync` (Expo's docs advise against it: it shows Apple's sheet); clear the app's own session instead |

`examples/use-apple-sign-in.ts` and `examples/auth-mutations.ts` show the server exchange through the
plain ApiClient (networking-and-server-state): `exchangeAppleCredential` is a direct request, never a
`useMutation`, because TanStack's MutationCache would keep the identity token, authorization code and
raw nonce (variables) and the app's tokens (data) until `gcTime`, visible in devtools and dehydrated
with paused mutations by a persisted query client.

## 7. Store rules: login services and account deletion

**App Store guideline 4.8 (Login Services)**, read 2026-10-10: an app that uses a third-party or social
login service (Google Sign-In, Facebook Login, ...) "to set up or authenticate the user's primary
account" must also offer an equivalent login service that limits data collection to name and email,
lets people keep their email private, and collects no interactions for advertising without consent.
Sign in with Apple meets all three. Not required when the app uses only its own account system, is an
education or enterprise app with existing accounts, uses a government or industry ID system, or is a
client for one specific third-party service.

**App Store guideline 5.1.1(v) (Account Sign-In)**: "If your app supports account creation, you must
also offer account deletion within the app." Also: let people use the app without a login when it has
no significant account-based features.

**Google Play**: an app that lets people create an account must "provide users with an in-app path to
delete their app accounts and associated data" and also "a web link resource where users can request
app account deletion and associated data deletion" (declared in Play Console's Data safety section).

What the app does (`account-deletion`, `contracts/auth.json` `createsAccounts` and
`accountDeletionRoute`):

1. A route inside the signed-in group that explains what is deleted and asks to confirm.
2. The server deletes the account and its data, and for a Sign in with Apple account revokes Apple's
   tokens (Apple's REST `/auth/revoke` with the stored Apple refresh token).
3. After the server confirms, `session.signOut('account-deleted')`: tokens wiped, every sign-out step
   run, the guards show sign-in. A failed delete keeps the person signed in and says so.

Deleting an account is irreversible and outward-facing: the agent builds the flow, and a human tests it
against a staging server before release.

## 8. Testing

- `createFakeOauth()`: queue `answerSignIn` / `answerRefresh`, hold a refresh open with
  `deferRefresh()`, read `calls`. An unscripted call rejects, so a test never passes on an answer it did
  not choose.
- `createFakeAppleSignIn({ isAvailable })`: queue answers, `setCredentialState`, `revoke()`, render the
  stand-in `Button` and `pressButton()`.
- Adapter tests use Jest's automock of the SDK (`jest.mock('expo-auth-session')`) read through a typed
  `jest.requireMock`, and assert the exact options: S256, `code_verifier`, `preferEphemeralSession`,
  the hashed nonce.

## 9. The device checklist

Before a release, by hand, on one iOS device and one Android device (named, never "the booted one"):

- [ ] Sign in with the provider; kill the app; it opens signed in without the browser.
- [ ] Sign out; sign in again: the provider asks for the account (iOS: no silent re-login).
- [ ] Android: no not-found flash when the browser returns.
- [ ] Sign in with Apple (iOS): first sign-in shares the name; a second sign-in still works without it.
- [ ] Delete the app, reinstall: signed out (iOS Keychain wipe).
- [ ] Airplane mode with an expired access token: the app stays signed in and shows offline.
- [ ] Account deletion against staging: signed out, and signing in again creates a new account.
