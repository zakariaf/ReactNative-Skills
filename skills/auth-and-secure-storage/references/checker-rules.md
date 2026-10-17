# check-auth: every rule, what it reads, and how to answer it

`node ${CLAUDE_SKILL_DIR}/scripts/check-auth.mjs [repo-root] [--contract <file>] [--json]`

App code is every `.ts`, `.tsx`, `.js` and `.jsx` file under `srcDir` and the routes folder
(`resolveLayout`), minus tests (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, the root `test/`)
and declaration files. Installed skills (`.agents/`, `.claude/`, `skills/`, any folder holding a
`SKILL.md`) are never read. Comments never count; rules that read identifiers ignore string contents,
rules that read strings (URLs, step names, the config) keep them.

## Contents

1. When the check applies
2. The rules
3. The contract
4. Configuration keys
5. Reading a result

## 1. When the check applies

- **NOT APPLICABLE** (exit 0) only when all three hold: none of `expo-secure-store`,
  `expo-auth-session`, `expo-apple-authentication` is in `package.json` or no app file imports one of
  them (sign-in is not built); the auth contract does not exist; and the four leak rules
  (`token-storage`, `token-in-state`, `token-in-log`, `token-in-url`) find nothing. Those four always
  run, because a hand-written sign-in that keeps tokens in AsyncStorage while expo-secure-store sits
  unused in `package.json` is exactly the case to catch. With the contract present the whole check
  runs (the contract says sign-in exists). The reference app pre-installs the stack, uses none of the
  packages and has no contract, so it reads NOT APPLICABLE.
- **Secrets only** (`"signIn": false` in the contract): an app that keeps a secret in expo-secure-store
  (a person's own API key, a key the server issued to this installation, a database key) but signs
  nobody in runs only the storage rules: `vendor-import`, `secure-store-call`, `secure-keys`, the four
  leak rules, `fresh-install-wipe` (the secrets of a previous install), `single-flight-refresh` and
  `secure-store-plugin`. `sign-out-steps`, `protected-groups`, `oauth-*`, `apple-sign-in` and
  `account-deletion` do not run, and the contract needs no other key. An app file that imports
  expo-auth-session or expo-apple-authentication while `signIn` is false is a `contract` problem: the
  app does sign people in.
- **Exit 2** without `package.json`, with malformed `package.json` or contract JSON, or an unknown option.
- There are no SKIP lines: everything this check reads is this skill's own work.

## 2. The rules

| Rule | Finds | Answer |
|---|---|---|
| `vendor-import` | one of the three packages imported outside `<servicesDir>/<concern>/*-adapter{,.ios,.android,.native,.web}.ts(x)`, or by a second adapter (a platform pair counts once) | use the port; one adapter per package |
| `secure-store-call` | in a file importing expo-secure-store: sync `getItem`/`setItem`; `getItemAsync`/`deleteItemAsync` with fewer than 2 arguments or `setItemAsync` with fewer than 3; `ALWAYS` or `ALWAYS_THIS_DEVICE_ONLY`; `requireAuthentication: true` without `// biometric-gate: <why>` | the one frozen options object, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` |
| `secure-keys` | no `export const SECURE_KEYS`; a value outside `/^[\w.-]+$/` or declared twice; no non-test, non-fake file using `ALL_SECURE_KEYS` or `Object.values(SECURE_KEYS)` | declare every key; wipe with a loop over the list |
| `token-storage` | a credential name (`accessToken`, `refresh_token`, `password`, `apiKey`, `secret_key`, `privateKey`, `encryptionKey`, ...) or a bare `token`, `jwt`, `credential(s)` (identifier or string, word-bounded, so `pushToken` and design `tokens` stay out) in a file importing `expo-sqlite`, `expo-sqlite/kv-store`, AsyncStorage, MMKV or `expo-file-system` | secure storage only |
| `token-in-state` | the same names in a file under `storesDir` or importing `zustand` (`{ token: null, setToken }` is the textbook case) | stores hold account id, name, status |
| `token-in-log` | in the arguments of `console.*`, `record`, `captureException`, `captureMessage`, `addBreadcrumb`, `logEvent`, `track`: a credential name, `Authorization`, `Bearer`, `code_verifier` or `rawNonce` anywhere; or an identifier (not a word inside a message string) named `token`, `tokens`, `jwt`, `grant` or `credential(s)` | log the kind and the key name |
| `token-in-url` | `?access_token=`, `#id_token=`, `&refresh_token=`, `?token=`, `code_verifier=` in a string or template | a header; the code flow |
| `fresh-install-wipe` | no non-fake app file that reads an install marker (`installMarker` / `InstallMarker` with `.isPresent(`) and wipes (`wipeSession(` or `ALL_SECURE_KEYS`) | the install marker check at restore |
| `single-flight-refresh` | a refresh site outside adapters (`*-adapter.ts`), fakes and files that implement the port (`: TokenRefresher` or `satisfies TokenRefresher`): a call `refresh*(...)` whose arguments name a refresh token (definitions and signatures skipped), a `refresh_token` field or value, or a string path ending in `/<auth|oauth|oauth2|connect|identity|token(s)|session(s)>/<refresh|token>` or `/refresh-token(s)`, or a path that is just `/refresh` (`'/refresh'`, `` `${base}/refresh` ``). More than one file with a site: every file but the owner (the one that shares its refresh) is reported; the owner without `singleFlight(<...refresh...>` / `refresh... ??=` is reported too | refresh only in the session manager, shared; the server's refresh endpoint lives in a `TokenRefresher` |
| `sign-out-steps` | nothing calls the session factory (`sessionFactory`, default `createSessionManager`) outside the file that defines it; or a `signOutSteps` or `serverSignOutSteps` name that the creating file neither writes as `'name'` nor makes with `nameInCamelStep(` | pass every step where the session is created, server steps in `serverSignOutSteps` |
| `protected-groups` | a `protectedGroups` entry without `<routesDir>/<group>/_layout.{tsx,ts,jsx,js}`; a group or `signedOutRoutes` entry not named by a `<X.Screen name="...">` inside an `<X.Protected>` element in any `.tsx`/`.jsx` app file (open and close tags matched by depth, so nested guards count; a self-closing `.Protected` has no body); `redirectTo` on `.Protected` while `package.json` names Expo below 58 | the group layout; the guard; screen order on SDK 57 |
| `oauth-pkce` | `usePKCE: false`; `ResponseType.Token`/`IdToken` or `responseType: 'token'`/`'id_token'`; `clientSecret:` or `client_secret`; `exchangeCodeAsync(` without `code_verifier`/`codeVerifier` in its arguments | code + PKCE, public client |
| `oauth-ephemeral` | `promptAsync(` without `preferEphemeralSession: true`, unless `oauthSharedBrowserSession` is a non-empty reason | the ephemeral session |
| `apple-sign-in` | expo-apple-authentication imported while the app config has neither `usesAppleSignIn: true` nor `'expo-apple-authentication'`; `signInAsync(` without `nonce:`; an importer that never mentions `ERR_REQUEST_CANCELED` | config, nonce, a silent cancel |
| `secure-store-plugin` | expo-secure-store imported while the app config does not list `'expo-secure-store'`; `configureAndroidBackup: false` with no `customAndroidBackupRules`; a `customAndroidBackupRules` path that does not exist | list the plugin, or own the rules |
| `account-deletion` | `createsAccounts: true` with no `accountDeletionRoute`, or one naming a missing file | build the deletion route |
| `contract` | the contract missing; `signIn` present but not a boolean; (with sign-in) `protectedGroups`, `signedOutRoutes` or `signOutSteps` not lists of non-empty strings, `serverSignOutSteps` present but not such a list, `createsAccounts` not a boolean; `signIn: false` while an app file imports expo-auth-session or expo-apple-authentication | follow `auth.schema.json` |

Known limits, on purpose (heuristics stay simple; the review and the Jest tests cover the rest):

- Names are matched as written. A token passed through an alias (`const t = tokens.accessToken;
  console.log(t)`), a store field named `secret` or `value`, or a storage key built at run time is
  missed.
- `token-in-log` reads identifiers for the bare names, so `console.log('token: ' + x)` (the word only
  in the message) passes; `Bearer` and the prefixed names count inside strings too.
- `single-flight-refresh` misses a refresh whose call is not named `refresh…` and whose request has no
  `refresh_token` and no token-endpoint path (a GraphQL mutation `renewSession`, a path such as
  `/v2/renew`), and a camel-case callee such as `tokenRefresh(`. A path such as `/feed/refresh` is
  not a token endpoint and is not read.
- `protected-groups` reads JSX as text: a screen list built in a loop or in another component is not
  followed. It checks that each group sits inside some `.Protected` element, not that the guard is the
  right boolean: `<Stack.Protected guard={!guards.isRestoring}>` around `(app)` passes. The app's own
  AppStack therefore needs a router test built from `session-guards.test.tsx` that opens a signed-in
  deep link while signed out and lands on sign-in (workflow step 10).
- The bare words are matched wherever a finding is already likely, so two shapes are false positives:
  a store setter whose parameter is named `token` though it holds a pagination cursor
  (`setNextPageToken: (token) => set({ nextPageToken: token })`, `token-in-state`), and a log of a
  lexer token (`console.warn('unexpected token', token)`, `token-in-log`). Rename the parameter
  (`cursor`, `lexeme`): the name then says what it holds, and the checker stays strict for real
  credentials.
- The app config is read as text, so a plugin list built in a helper from another file is not
  followed.

## 3. The contract

`contracts/auth.json` (template with schema) holds this app's facts:

| Key | Meaning |
|---|---|
| `signIn` | default `true`; `false` for an app that keeps secrets but has no sign-in (then no other key is needed: `{ "signIn": false }`) |
| `sessionFactory` | the function that creates the session (default `createSessionManager`) |
| `protectedGroups` | route groups only a signed-in person may open, e.g. `"(app)"` |
| `signedOutRoutes` | routes only a signed-out person sees, e.g. `"sign-in"` |
| `signOutSteps` | kebab-case names of every local sign-out step besides the token wipe (run after it) |
| `serverSignOutSteps` | optional: kebab-case names of the server steps that run before the wipe with the still-valid token (`push-registration`, `server-session`) |
| `createsAccounts` | whether people can create an account in the app |
| `accountDeletionRoute` | the route file that starts deletion (required when `createsAccounts`) |
| `oauthSharedBrowserSession` | `null`, or the reason the app shares browser cookies with the provider |
| `customAndroidBackupRules` | `null`, or the app's own backup rules file excluding SecureStore |

## 4. Configuration keys

From `rn-skills.config.json` (optional): the layout keys `srcDir`, `routesDir`, `servicesDir`,
`storesDir`, `contractsDir`, and `authContract` (the contract path; `--contract` wins over it).

## 5. Reading a result

```
FAIL contracts/auth.json:5 [protected-groups] src/app/(app)/_layout.tsx is missing: ... Fix: ...
check-auth: 184 app files checked, 1 problems
RESULT: FAIL (1 problems)
```

Exit 0 with `RESULT: PASS` (or `NOT APPLICABLE: <fact>` then `RESULT: PASS`), exit 1 with problems,
exit 2 with `ERROR [bad-input]`. The self-test (`node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs`) plants
one bug per rule on top of the shipped templates and examples.
