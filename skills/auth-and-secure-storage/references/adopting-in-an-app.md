# Adopting sign-in in an app

The exact edits that turn the templates into a working sign-in, in order. They were made on a copy of
the reference app on 2026-10-10, where `tsc` (both programs), ESLint `--max-warnings 0`, Prettier,
Jest (190 suites, 1,203 tests), spec-traceability's check-spec-refs, the checkers of
architecture-and-boundaries, naming-conventions, error-handling-typed-results,
react-components-and-hooks, async-safety, i18n-strings-and-catalogs, accessibility-as-code,
typescript-and-lint-rules, state-management-zustand, unit-and-component-tests, motion-and-animation,
rtl-and-direction, design-system-structure, dependency-management and this skill's check-auth all
passed. Two checkers report until their own step is done: expo-prebuild-and-config-plugins' native
snapshot (section 2) and tdd-workflow's check-tests for the adopted examples (section 11).

## Contents

1. Prerequisites
2. Packages and the app config
3. Templates
4. The composition root
5. Architecture and lint lists
6. Config and environment variables
7. The session in AppRoot and RootStack
8. Routes and screens
9. Sign-out steps and the contract
10. Messages
11. Tests for the adopted examples
12. Run the checks
13. Migrating an existing sign-in

## 1. Prerequisites

Canonical files from finished skills that the templates import: `src/core/result.ts`
(error-handling-typed-results), the clock and error-log ports with their fakes
(architecture-and-boundaries), `src/services/async/with-timeout.ts` (async-safety),
`src/hooks/use-is-app-active.ts` (react-components-and-hooks), `test/flush-microtasks.ts` and
`test/render-router-with-providers.tsx` (unit-and-component-tests), valibot and fast-check. The
OAuth flow needs a provider that supports the authorization code flow with PKCE for a public client.

## 2. Packages and the app config

```sh
npx expo install expo-secure-store expo-auth-session expo-web-browser expo-crypto expo-apple-authentication
```

All are in the Expo SDK 57 module map (dependency-management). In `app.config.ts`, inside `plugins`:

```ts
// Sign in with Apple: the com.apple.developer.applesignin entitlement (iOS).
'expo-apple-authentication',
// Android Auto Backup leaves the SecureStore preferences out; no Face ID purpose string.
['expo-secure-store', { faceIDPermission: false }],
```

Keep a `scheme` per variant (app-variants-and-environment). A plugin change needs a new native build;
`npx expo config --type introspect` shows its effect without one.

The expo-secure-store plugin changes the Android manifest (its backup rules), and Apple's plugin adds
an entitlement. When the app keeps a native snapshot (expo-prebuild-and-config-plugins'
`contracts/native-config.json`), its checker reports native drift until the snapshot is refreshed:
regenerate it with that skill's command in the same change, and read the diff (it should show only the
backup rules and the entitlement).

## 3. Templates

Copy every file under `templates/` to the path its first line names (the JSON contracts land at their
path under `templates/`): `src/core/session/*`, `src/services/{secure-storage,install-marker,oauth,
apple-sign-in,session}/*`, `test/session/session-test-kit.ts`, `contracts/auth.json` and its schema.
Each comes with its test.

## 4. The composition root

Add one member per port to `Services` and one line to each factory (the composition root's own rule):

```ts
// src/services/services-context.tsx
readonly secureStorage: SecureStoragePort;
readonly installMarker: InstallMarkerPort;
readonly oauth: OauthPort;
readonly appleSignIn: AppleSignInPort;

// src/services/create-device-services.ts (examples/create-device-services.ts)
secureStorage: createExpoSecureStoreAdapter({ errorLog }),
installMarker: createKvInstallMarkerAdapter({ errorLog }),
oauth: createAuthSessionOauthAdapter(readOauthConfig()),
appleSignIn: createExpoAppleSignInAdapter(),

// src/services/create-test-services.ts
secureStorage: given.secureStorage ?? missingPort('secureStorage'),   // and the other three
```

Then update `create-device-services.test.ts`: the expected key list gains the four names, the test sets
the OAuth variables on the real `process.env` (Babel reads `EXPO_PUBLIC_*` at run time in Jest; keep the
sample https URL in a JSON file, since the lint bans remote URL literals in TypeScript outside
`src/config`), and mocks `expo-constants` with `jest.requireActual` plus a `scheme`.

## 5. Architecture and lint lists

`contracts/architecture.json` (architecture-and-boundaries) records each SDK with its port:

```json
"vendorSdks": {
  "expo-secure-store": "SecureStoragePort",
  "expo-auth-session": "OauthPort",
  "expo-apple-authentication": "AppleSignInPort",
  "expo-crypto": "AppleSignInPort"
}
```

and `eslint.config.mjs` `VENDOR_SDK_PATHS` mirrors it (`vendor('expo-secure-store',
'SecureStoragePort')`, ...), so ESLint and check-boundaries agree. check-auth's `vendor-import` enforces
the three auth packages on its own until then.

## 6. Config and environment variables

`src/config/oauth-config.ts` (example) reads `EXPO_PUBLIC_OAUTH_ISSUER` (https) and
`EXPO_PUBLIC_OAUTH_CLIENT_ID`, declared in `src/env.d.ts`, set per EAS environment. Both are public by
design. No client secret exists anywhere.

## 7. The session in AppRoot and RootStack

```tsx
// AppRoot: once per run
const [session] = useState(() =>
  createAppSession(services, { queryCache: queryClient, resetAccountStore }),
);
// ...
<RootStack session={session} />

// RootStack (examples/root-stack.tsx): around AppStack
<NavigationThemeProvider>
  <SessionProvider session={session}>
    <AppStack />
  </SessionProvider>
</NavigationThemeProvider>
```

`createAppSession` passes `createServerRefresher(services.api)` (examples/server-refresher.ts) as the
session's one refresher: every sign-in method is exchanged at the app's server, so every session
refreshes there (session-lifecycle section 3). `services.api` is networking-and-server-state's plain
ApiClient. An app with no server and OAuth as its only sign-in passes `services.oauth` instead.

`AppStack` (examples/app-stack.tsx) reads the guards and always renders the Stack, with a guarded
`checking-session` route for a session that is still unknown. It calls no `SplashScreen` function: the
splash is app-startup-and-bootstrap's (one hold in `hold-splash.ts`, one release in `AppRoot` through
`useStartupReady`), and the restore joins its startup gate as the blocking task
`restoreSessionTask(session)` under `deadlineMs` (session-lifecycle.md section 9).

## 8. Routes and screens

- `src/app/(app)/_layout.tsx` must exist (protected-routes.md section 3).
- `src/app/sign-in.tsx` renders `SignInScreen` with `useSignInModel()` (examples).
- `src/app/oauth-redirect.tsx` with `useOauthRedirect()` (examples).
- When the app creates accounts: `src/app/(app)/delete-account.tsx` with
  `useDeleteAccountModel(api)` (example) over `authMutations.deleteAccount`.
- Requests to the app's own server go through `createAuthorizedApiClient` (example) and mutation
  factories in `src/api/` (networking-and-server-state). The Apple exchange
  (`exchangeAppleCredential`) is a plain request over the plain ApiClient, never a `useMutation`: the
  MutationCache would keep Apple's credential (variables) and the app's tokens (data) until `gcTime`,
  readable in devtools and dehydrated by a persisted query client. The OAuth id token exchange
  (`exchangeOauthIdToken`) follows the same rule.
- A sign-in or sign-up form of the app's own (email and password, a one-time code) uses
  forms-and-input's `TextField` kinds (`email`, `username`, `current-password`, `new-password`,
  `one-time-code`, which set the iOS text content type and the Android autofill hint), with the
  username or email field directly before the password. Passwords and codes never go into a form
  draft. Password managers offer saved logins only with Associated Domains
  (`ios.associatedDomains: ['webcredentials:<domain>']` plus the apple-app-site-association file) and,
  on Android, Digital Asset Links; a server password policy belongs in `passwordRules`.

## 9. Sign-out steps and the contract

List in `contracts/auth.json` every place the person's data lives besides the secure store, and pass
each as a step where the session is created. Local data goes in `signOutSteps` (run after the wipe,
in order); a call to the app's server that needs the session goes in `serverSignOutSteps` (run first,
with the still-valid token, on `signOut('user')`, under one 5 s deadline):

| Data | Phase | Step |
|---|---|---|
| a push token registered for the account | server | `pushRegistrationStep(services.pushRegistration)` in `serverSignOutSteps` (push-notifications: named `push-registration`, it sends the DELETE through the signed-in client and forwards only the deadline's `signal`) |
| a server-side session the app opened | server | `{ name: 'server-session', run: ({ signal }) => endServerSession(api, signal) }` in `serverSignOutSteps` |
| background jobs for the account | local, first | `{ name: 'background-tasks', run }` whose `run` awaits `reconcileBackgroundTasks({ ..., isEnabled: false })` and throws when that Result fails (background-tasks), so no job runs for a signed-out account; never `TaskManager.unregisterAllTasksAsync()`, which also removes location and notification tasks |
| a deep link waiting behind the signed-in guard | local | `{ name: 'pending-links', run: () => pendingLinks.clear() }` (deep-links-and-universal-links; the component that decides the signed-in `Stack.Protected` guard calls `useLinkGate('signed-in', isSignedIn)`) |
| TanStack Query cache | local | `queryCacheStep(queryClient)` → `query-cache` |
| a per-account Zustand store | local | `storeResetStep('account-store', reset)` |
| per-account SQLite rows | local | `{ name: 'account-rows', run: () => repository.deleteAll() }` |
| scheduled notifications for the account | local | `{ name: 'account-reminders', run: cancelAll }` (local-notifications) |

A server step that ran after the wipe would go out signed out: `sendWithSession` answers `signed-out`
without throwing, nothing is recorded, and the next person on the phone receives the previous person's
notifications. When the server ends the session itself (expired, revoked, account deleted), the
server phase is skipped, so the server must drop that session's push registrations on its own.

Account deletion (`use-delete-account-model`) also calls `services.analytics.forget()` when the app
ships analytics-and-consent: it clears the saved analytics answer, resets the SDK's anonymous identity
and opts it out. Data already on the vendor's servers needs a deletion request the developer files with
the vendor (Play's Data safety form asks about it).

Fill in `protectedGroups`, `signedOutRoutes`, `signOutSteps`, `serverSignOutSteps`, `createsAccounts`
(a boolean: privacy-and-store-declarations reads it both ways, so `false` is a stated "no accounts")
and `accountDeletionRoute`.

## 10. Messages

Add the sign-in and account-deletion copy to every catalog (i18n-strings-and-catalogs):
`sign-in.title`, `sign-in.continue`, `sign-in.working`, `sign-in.failed`, `account.delete.title`,
`account.delete.confirm`.

## 11. Tests for the adopted examples

The examples become app code once adopted, and tdd-workflow's `check-tests` reports each logic module
that no test imports (`untested-module`): on the reference app these were `use-sign-in-model`,
`use-apple-sign-in`, `use-oauth-redirect`, `use-delete-account-model`, `create-app-session`,
`authorized-api-client`, `auth-mutations` and `server-refresher`. Write one test file per module next to it, red first:

- hooks: `renderHook` inside a wrapper that renders `SessionProvider` with `createSessionTestKit()`'s
  session and the test services (`createFakeOauth`, `createFakeAppleSignIn`, a fake ApiClient); assert
  the outcome (`signed-in`, `cancelled`, `failed`) and the session's snapshot afterwards;
- `create-app-session`: sign out and assert every step ran in order (and the server step saw a token);
- `authorized-api-client`: a scripted transport that answers 401 once, then twice (one renewal, then a
  sign-out);
- `auth-mutations`: `exchangeAppleCredential` and `exchangeOauthIdToken` against the fake ApiClient
  (path, body, schema);
- `server-refresher`: the fake ApiClient answers `/auth/refresh` once with rotated tokens and once
  with 401; the template test `server-token-refresher.test.ts` already proves the mapping and that an
  Apple-signed session refreshes at the server.

## 12. Run the checks

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-auth.mjs .
npm run typecheck && npx eslint . --max-warnings 0 && npx jest --ci
```

Then the device checklist in oauth-and-apple.md section 9.

## 13. Migrating an existing sign-in

An app that already has people signed in (tokens in AsyncStorage, kv-store, or expo-secure-store
under other keys) must not sign them all out with the update, and must not leave the old copies
behind. Without a migration the first launch after the update finds no install marker, wipes the
declared keys (there is nothing in them) and reads as signed out, while the legacy values stay on
disk.

Ship it in one release, in this order, inside the session's startup (before `restore()` runs):

1. **Read the legacy store** through a one-off migration adapter (it is the only code that still
   imports the old storage; delete it in a later release).
2. **Write the install marker first** when a legacy session exists in the app sandbox (AsyncStorage,
   kv-store, files: all removed by an uninstall, so they prove this install is the same one). Without
   the marker the fresh-install wipe would run against the keys you are about to fill. A legacy
   session in the Keychain (expo-secure-store under other keys) proves nothing, because the Keychain
   outlives an uninstall: write the marker only when the sandbox also holds something the previous
   release wrote (its settings, its database); otherwise treat it as a fresh install and wipe the
   legacy keys too.
3. **Move the tokens to the declared keys** with the session vault's `writeSession` (refresh token
   first), then **delete the legacy values** and record that the migration ran (a kv-store flag, not
   a secret). A failed write leaves the legacy values in place and tries again at the next launch.
4. Then `restore()` reads the declared keys as usual.

A legacy session that cannot be parsed is dropped with the legacy store (signed out with reason
`null`). Test the migration with the fakes (seed the legacy adapter, run startup, expect `signed-in`
and an empty legacy store) and once on a device that has the previous release installed.
