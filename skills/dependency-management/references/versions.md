# The canonical-stack versions (the seed of the dependency policy)

The versions this skill seeds `contracts/dependency-policy.json` with: what a fresh Expo SDK 57 app
resolves under a 7-day minimum release age, verified on 2026-10-03 (Expo `expo` 57.0.26, React
Native 0.86.3, React 19.2.3, npm 11.17, Node 26.4); the Expo module rows moved to `expo` 57.0.27's
module map on 2026-10-17 (the newest SDK 57 patch past the release age that day). The app's copy of the policy is the truth for the
app; this page explains the seed and how to re-verify it. A row is a permission, not a requirement:
delete the rows the app will never use.

## Contents

- Why a written table
- The rows, by area (seven tables)
- Companions and root overrides
- Held-back majors and their triggers
- Do not add
- Toolchain outside npm
- When the app uses React Navigation 7 (fenced alternative)
- When multi-package
- Re-verifying versions (they age)

## Why a written table

1. **Training data is stale.** On 2026-10-03 npm already carries React Native 0.87.1, TypeScript
   7.0.2, ESLint 10.11.0, Jest 30.5.2 and Skia 2.13.0. None is right for an Expo SDK 57 app; npm
   `latest` is the wrong major for several packages. The policy is the truth, memory is not.
2. **Expo pins a tested set of native module versions per SDK.** The set is
   `expo/bundledNativeModules.json` (this skill carries the copy from `expo` 57.0.27 as
   `assets/expo-sdk-57-module-map.json`, the checkers read the installed one first).
   `npx expo install` applies it and `npx expo install --check` verifies it. Anything outside that set
   is the app's responsibility, so it gets an exact version.
3. **One place for the why.** Every row says why this package and this version, so the next upgrade
   starts from a reason instead of a guess.

Columns: **Spec** is what goes into `package.json`: the `~x.y.z` that `npx expo install <pkg>@~x.y.z`
writes for an Expo-managed module (always pass it), otherwise the exact version (`save-exact`).
**Install** is how it gets there; (native) marks a package with iOS or Android code (a rebuild).

## The rows, by area

### Expo SDK, React and the web target

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `expo` | 57.0.27 | `~57.0.27` | npx expo install (native) | the Expo SDK 57 line (sdk-57 dist-tag); moves only with expo-sdk-upgrade |
| `react` | 19.2.3 | `19.2.3` | npx expo install | the React of Expo SDK 57; 19.3 belongs to SDK 58 |
| `react-native` | 0.86.3 | `0.86.3` | npx expo install (native) | the React Native of Expo SDK 57; npm latest 0.87.1 is not for SDK 57 |
| `react-dom` | 19.2.3 | `19.2.3` | npx expo install | web target (Expo template default); remove it with react-native-web and the web script when the app ships no web build |
| `react-native-web` | 0.21.3 | `~0.21.0` | npx expo install | web target (Expo template default); remove it with react-dom and the web script when the app ships no web build |
| `expo-status-bar` | 57.0.1 | `~57.0.1` | npx expo install (native) | the status bar component of the Expo template |
| `expo-system-ui` | 57.0.4 | `~57.0.4` | npx expo install (native) | userInterfaceStyle automatic needs it on Android (root background follows the theme); used implicitly: read by the config plugin and the Android root view when app.config sets userInterfaceStyle |
| `expo-splash-screen` | 57.0.9 | `~57.0.9` | npx expo install (native) | the splash config plugin and hiding the splash after startup |
| `expo-font` | 57.0.4 | `~57.0.4` | npx expo install (native) | fonts embedded by the config plugin |
| `expo-build-properties` | 57.0.22 | `~57.0.22` | npx expo install | native build settings (iOS deployment target, Android SDK levels) through its config plugin |
| `expo-dev-client` | 57.0.19 | `~57.0.19` | npx expo install (native) | development builds (the development variant); never part of preview or production builds; used implicitly: linked into development builds, which open it at launch |
| `expo-updates` | 57.0.25 | `~57.0.25` | npx expo install (native) | OTA updates through EAS Update (ota-updates); configured in app.config; used implicitly: configured in app.config (updates, runtimeVersion); its native code checks for updates at launch |

### Navigation (Expo Router and its peers)

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `expo-router` | 57.0.25 | `~57.0.25` | npx expo install (native) | navigation (file routes in src/app); installed with its peers in one command |
| `expo-linking` | 57.0.12 | `~57.0.12` | npx expo install (native) | a peer of expo-router (links and the URL of the running app); used implicitly: a peer of expo-router, which loads it |
| `expo-constants` | 57.0.21 | `~57.0.21` | npx expo install (native) | a peer of expo-router; runtime read of expo.extra; used implicitly: a peer of expo-router, which loads it |
| `react-native-screens` | 4.26.2 | `~4.26.0` | npx expo install (native) | a peer of expo-router (native screen containers); used implicitly: a peer of expo-router, which loads it |
| `react-native-safe-area-context` | 5.7.0 | `~5.7.0` | npx expo install (native) | a peer of expo-router; insets for every screen; used implicitly: a peer of expo-router, which loads it |

### Animation, gestures, canvas, lists, keyboard

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `react-native-reanimated` | 4.5.1 | `4.5.1` | npx expo install (native) | animation (.get()/.set()); 4.7 arrives with SDK 58; used implicitly: a peer of expo-router, which loads it when installed |
| `react-native-worklets` | 0.10.1 | `0.10.1` | npx expo install (native) | the worklet runtime Reanimated 4 needs; pre-1.0 and pinned exactly by Expo; used implicitly: loaded by react-native-reanimated |
| `react-native-gesture-handler` | 2.32.0 | `~2.32.0` | npx expo install (native) | gestures (builder API); 3.x arrives with SDK 58; used implicitly: a peer of expo-router, which loads it when installed |
| `@shopify/react-native-skia` | 2.6.2 | `2.6.2` | npx expo install (native) | canvas rendering; npm latest 2.13.0 is not for SDK 57; its postinstall copies native libraries and needs a review |
| `@shopify/flash-list` | 2.0.2 | `2.0.2` | npx expo install | long lists, once measured (react-components-and-hooks) |
| `react-native-keyboard-controller` | 1.21.9 | `1.21.9` | npx expo install (native) | keyboard avoidance for forms (forms-and-input) |

### State, data, forms, i18n

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `zustand` | 5.0.15 | `5.0.15` | npm install | client state, one store per domain (state-management-zustand) |
| `@tanstack/react-query` | 5.104.0 | `5.104.0` | npm install | server state over the ApiClient port (networking-and-server-state) |
| `valibot` | 1.5.0 | `1.5.0` | npm install | schemas: one definition gives the type and the runtime check (no eval, no dependencies) |
| `react-hook-form` | 7.89.0 | `7.89.0` | npm install | forms (forms-and-input) |
| `@hookform/resolvers` | 5.9.1 | `5.9.1` | npm install | the valibot resolver for react-hook-form |
| `expo-sqlite` | 57.0.4 | `~57.0.4` | npx expo install (native) | persistence behind the SqlDriver port; expo-sqlite/kv-store for small preferences |
| `expo-secure-store` | 57.0.4 | `~57.0.4` | npx expo install (native) | tokens and secrets (auth-and-secure-storage) |
| `react-intl` | 12.1.3 | `12.1.3` | npm install | ICU messages (i18n-strings-and-catalogs) |
| `@formatjs/intl-getcanonicallocales` | 3.2.12 | `3.2.12` | npm install | Intl polyfill where Hermes lacks the API |
| `@formatjs/intl-locale` | 5.3.12 | `5.3.12` | npm install | Intl polyfill where Hermes lacks the API |
| `@formatjs/intl-pluralrules` | 6.3.15 | `6.3.15` | npm install | Intl polyfill where Hermes lacks the API |
| `@formatjs/intl-numberformat` | 9.4.3 | `9.4.3` | npm install | Intl polyfill where Hermes lacks the API |
| `expo-localization` | 57.0.2 | `~57.0.2` | npx expo install (native) | device locales and the supportedLocales plugin option |

### Platform modules

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `expo-haptics` | 57.0.3 | `~57.0.3` | npx expo install (native) | haptic feedback behind HapticsPort (audio-and-haptics-feedback) |
| `expo-network` | 57.0.2 | `~57.0.2` | npx expo install (native) | connectivity state behind ConnectivityPort; no HTTP probe of its own |
| `expo-notifications` | 57.0.22 | `~57.0.22` | npx expo install (native) | local and push notifications (local-notifications, push-notifications) |
| `expo-image` | 57.0.5 | `~57.0.5` | npx expo install (native) | images with caching (media-images-and-files) |
| `expo-image-picker` | 57.0.20 | `~57.0.20` | npx expo install (native) | photo library and camera picking (media-images-and-files) |
| `expo-file-system` | 57.0.7 | `~57.0.7` | npx expo install (native) | files in the app sandbox (data-export-and-restore) |
| `expo-sharing` | 57.0.22 | `~57.0.22` | npx expo install (native) | the OS share sheet for exported files |
| `expo-document-picker` | 57.0.3 | `~57.0.3` | npx expo install (native) | picking a file to import or restore |
| `expo-background-task` | 57.0.21 | `~57.0.21` | npx expo install (native) | deferred background work (background-tasks) |
| `expo-task-manager` | 57.0.21 | `~57.0.21` | npx expo install (native) | task registration for background tasks |
| `expo-web-browser` | 57.0.3 | `~57.0.3` | npx expo install (native) | auth sessions and links opened in the system browser |
| `expo-auth-session` | 57.0.14 | `~57.0.14` | npx expo install | OAuth flows (auth-and-secure-storage) |
| `expo-crypto` | 57.0.3 | `~57.0.3` | npx expo install (native) | hashing and random values |
| `expo-apple-authentication` | 57.0.2 | `~57.0.2` | npx expo install (native) | Sign in with Apple (iOS) |
| `expo-clipboard` | 57.0.2 | `~57.0.2` | npx expo install (native) | copy and paste |
| `expo-store-review` | 57.0.3 | `~57.0.3` | npx expo install (native) | the OS in-app review prompt |
| `react-native-audio-api` | 0.13.6 | `0.13.6` | npm install (native) | UI sounds behind AudioPort (audio-and-haptics-feedback); pre-1.0, not in the Expo map |

### Ads, purchases, consent, crash reporting

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `react-native-google-mobile-ads` | 17.2.0 | `17.2.0` | npm install (native) | ads and the UMP consent form (admob-ads-and-consent); not in the Expo map |
| `expo-iap` | 5.8.0 | `5.8.0` | npm install (native) | in-app purchases behind PurchasePort (in-app-purchases); not in the Expo map |
| `expo-tracking-transparency` | 57.0.2 | `~57.0.2` | npx expo install (native) | the App Tracking Transparency prompt (iOS) before ad requests (admob-ads-and-consent) |
| `@sentry/react-native` | 7.11.0 | `~7.11.0` | npx expo install (native) | crash reporting behind CrashReporterPort; npm latest 8.x is outside the SDK 57 map |

### Development tools (devDependencies)

| Package | Version | Spec | Install | Why |
|---|---|---|---|---|
| `@formatjs/cli` | 6.16.32 | `6.16.32` | npm install -D | FormatJS verify of the catalogs in `npm run i18n:verify` (i18n-strings-and-catalogs) |
| `@formatjs/icu-messageformat-parser` | 3.5.20 | `3.5.20` | npm install -D | the ICU parser of the catalog linter (i18n-strings-and-catalogs) |
| `@react-native/eslint-plugin` | 0.86.3 | `0.86.3` | npm install -D | no-deep-imports; must equal the React Native version |
| `@react-native/jest-preset` | 0.86.3 | `0.86.3` | npm install -D | a jest-expo peer that must equal the React Native version |
| `@stryker-mutator/core` | 10.0.0 | `10.0.0` | npm install -D | mutation testing (the stryker binary) |
| `@stryker-mutator/jest-runner` | 10.0.0 | `10.0.0` | npm install -D | mutation testing with Jest |
| `@stryker-mutator/typescript-checker` | 10.0.0 | `10.0.0` | npm install -D | mutation testing: drops mutants that do not type-check |
| `@testing-library/react-native` | 14.0.1 | `14.0.1` | npm install -D | component tests with the async API (unit-and-component-tests) |
| `@types/jest` | 29.5.14 | `29.5.14` | npm install -D | the Expo related pin for Jest 29 |
| `@types/jest-image-snapshot` | 6.4.2 | `6.4.2` | npm install -D | types for jest-image-snapshot, which ships none |
| `@types/node` | 26.4.1 | `26.4.1` | npm install -D | the Node 26.4 runtime of the tooling |
| `@types/react` | 19.2.18 | `19.2.18` | npm install -D | inside the Expo related range ~19.2.x |
| `babel-jest` | 29.7.0 | `29.7.0` | npm install -D | the same release as jest |
| `eslint` | 9.39.5 | `9.39.5` | npm install -D | ESLint 10 breaks eslint-plugin-react inside eslint-config-expo 57; deprecated, accepted: ESLint 9 is end of life (npm marks 9.x deprecated); held back until eslint-config-expo supports ESLint 10 (heldBack); dev-only, never shipped |
| `eslint-config-expo` | 57.0.2 | `57.0.2` | npm install -D | brings eslint-plugin-react, react-hooks 7 and import (in the Expo map; pinned exactly inside its range) |
| `eslint-config-prettier` | 10.1.8 | `10.1.8` | npm install -D | last in the flat config |
| `eslint-plugin-check-file` | 3.3.2 | `3.3.2` | npm install -D | kebab-case files and folders |
| `eslint-plugin-formatjs` | 8.1.0 | `8.1.0` | npm install -D | no literal strings in JSX |
| `eslint-plugin-jest` | 29.16.6 | `29.16.6` | npm install -D | test rules |
| `eslint-plugin-react-native` | 5.0.0 | `5.0.0` | npm install -D | React Native style rules; peer ESLint 9 |
| `eslint-plugin-sonarjs` | 4.2.1 | `4.2.1` | npm install -D | cognitive complexity; LGPL-3.0-only, dev-only (never shipped) |
| `eslint-plugin-testing-library` | 7.16.2 | `7.16.2` | npm install -D | test rules for RNTL |
| `fast-check` | 4.10.2 | `4.10.2` | npm install -D | property tests |
| `globals` | 17.12.0 | `17.12.0` | npm install -D | Node globals for JS config files |
| `jest` | 29.7.0 | `29.7.0` | npm install -D | Expo related ~29.7.0; Jest 30 is not supported by jest-expo 57 |
| `jest-expo` | 57.0.5 | `57.0.5` | npm install -D | the SDK 57 Jest preset (in the Expo map; pinned exactly inside its range) |
| `jest-image-snapshot` | 6.5.2 | `6.5.2` | npm install -D | pixel goldens (golden-and-snapshot-tests) |
| `knip` | 6.38.0 | `6.38.0` | npm install -D | unused files, exports and dependencies |
| `lefthook` | 2.1.14 | `2.1.14` | npm install -D | git hooks; its postinstall needs a review |
| `prettier` | 3.9.9 | `3.9.9` | npm install -D | formatting; 4.0 is not stable |
| `test-renderer` | 1.2.0 | `1.2.0` | npm install -D | the React 19.2 line RNTL 14 renders with; 1.3.0 targets React 19.3 (SDK 58) |
| `typescript` | 6.0.3 | `6.0.3` | npm install -D | Expo lists ~6.0.3; TypeScript 7 has no programmatic API and typescript-eslint supports <6.1.0 |
| `typescript-eslint` | 8.70.1 | `8.70.1` | npm install -D | strictTypeChecked; peer typescript <6.1.0 |

## Companions and root overrides

Some pins hold only when a second package is pinned with them, because npm would otherwise resolve
that package on a range to a release outside the SDK 57 set. The policy records these as `companions`
of the row that needs them; `plan-dependency.mjs` prints them in the install command, and
`check-deps-policy.mjs` fails a missing companion (`companion`) and a second installed copy
(`one-version`).

| Row | Companion | How | Why |
|---|---|---|---|
| `@testing-library/react-native` 14.0.1 | `test-renderer` 1.2.0 | same command: `npm install -D test-renderer@1.2.0 @testing-library/react-native@14.0.1` | a `^1.0.0` peer: installed alone, npm picked 1.3.0, the React 19.3 (SDK 58) line (seen 2026-09-29) |
| `jest-image-snapshot` 6.5.2 | `@types/jest-image-snapshot` 6.4.2 | same command | the package ships no types: installed alone, typecheck fails with `TS7016: Could not find a declaration file for module 'jest-image-snapshot'` (seen 2026-09-30) |
| `expo-router` ~57.0.24 | `react-native-screens`, `react-native-safe-area-context`, `expo-linking`, `expo-constants` | one `npx expo install` with every spec | peers: installed alone, npm adds their newest releases, not the SDK 57 ones |
| `react-native-reanimated` 4.5.1 | `react-native-worklets` 0.10.1 | together | a 0.10.x peer that Expo pins exactly |
| `jest-expo` 57.0.5 | `@react-native/jest-preset` 0.86.3 | together | a peer that must equal the React Native version |
| `@stryker-mutator/jest-runner`, `/typescript-checker` 10.0.0 | `@stryker-mutator/core` 10.0.0 | together | an exact peer |
| `firebase-tools` 15.33.0 (when the app runs the Firebase emulators) | `superstatic` 11.0.0 | root `overrides` | firebase-tools asks for `^10.0.0`, whose only release 10.0.0 declares `node: "20 \|\| 22 \|\| 24"`: under `engine-strict` on Node 26 the install stops with `EBADENGINE` (seen 2026-10-21, re-verified 2026-10-22 with npm 11.20.0); 11.0.0 declares `22 \|\| 24 \|\| 26`. In a workspace repo the override sits in the root `package.json` (one lockfile). Drop it when a firebase-tools release past the release age depends on superstatic 11 (`npm view firebase-tools@<pin> dependencies.superstatic`) |
| `typescript-eslint` 8.70.1 | the ten `@typescript-eslint/*` packages (`eslint-plugin`, `parser`, `project-service`, `scope-manager`, `tsconfig-utils`, `type-utils`, `types`, `typescript-estree`, `utils`, `visitor-keys`) at 8.70.1 | root `overrides` | `eslint-config-expo` asks for `^8.59.0`; a newer copy at the root next to typescript-eslint's own crashes every ESLint run with `Cannot redefine plugin "@typescript-eslint"` (seen 2026-09-29 with 8.71.0) |

The root `overrides` hold only these kinds of key, and `check-deps-policy.mjs` fails any other
(`stale-override`): `react` and `react-native` at the app's versions; the companions marked "root
overrides"; rows marked `"override": true` (a deliberate pin of a transitive package, with its why);
when multi-package, every `"*"` peer of a shared package at the version the apps install. An override
moves with its row.

## Held-back majors and their triggers

| Held back | Allowed | Trigger to revisit |
|---|---|---|
| ESLint 10 | `^9.` | `eslint-config-expo` ships an `eslint-plugin-react` that supports ESLint 10 |
| TypeScript 7 | `^6.0.` | typescript-eslint supports TypeScript 7 and Expo's related packages list it |
| Jest 30 | `^29.` | `jest-expo` for the app's SDK depends on Jest 30: met by SDK 58 (`jest-expo` 58.0.x peers `jest` `^30.0.0`, checked 2026-10-10 on the `next` tag), so `jest`, `babel-jest` and `@types/jest` (30.x) and `test-renderer` (1.3.0) move in the SDK 58 commit (expo-sdk-upgrade), never before |
| Prettier 4 | `^3.` | a stable release and a reviewed formatting diff |
| React 19.3, React Native 0.87+ | `^19.2.`, `^0.86.` | only with the Expo SDK that pins them (expo-sdk-upgrade) |
| `test-renderer` 1.3 | `^1.2.` | React 19.3 arrives with the next Expo SDK |
| Gesture Handler 3, Reanimated 4.7, Skia 2.11+ | `^2.`, `^4.5.`, `^2.6.` | arrive with SDK 58 through `npx expo install --fix` (expo-sdk-upgrade) |
| `@sentry/react-native` 8 | `^7.` | the Expo SDK map moves to 8.x |
| `react-native-audio-api` 1.0 | `^0.` | a stable 1.0 plus a sound smoke test on a named iOS simulator and Android emulator |

ESLint 9 is end of life and npm marks 9.x deprecated, so its row carries a `deprecated` reason; that
is the only accepted deprecation in the seed.

## Do not add

The seed's `doNotAdd` (each is checked as a direct dependency, `do-not-add`): `babel-preset-expo`
(comes with `expo`), `babel-plugin-react-compiler` (comes with `babel-preset-expo`; the compiler is
switched on with `experiments.reactCompiler`), `eslint-plugin-react-compiler` (superseded by
`eslint-plugin-react-hooks` 7), `react-native-restart` (`reloadAppAsync` from `expo`), `expo-av` (not
in the SDK 57 map; `expo-audio`, `expo-video`), `sentry-expo` (superseded by `@sentry/react-native`),
`@react-native-async-storage/async-storage` (the stack keeps preferences in `expo-sqlite/kv-store` and
secrets in `expo-secure-store`), `react-native-iap` (the stack buys through `expo-iap`), and the HTTP
clients `axios`, `ky`, `got`, `node-fetch`, `cross-fetch` (the app requests through the ApiClient
port over the built-in `fetch`; some tools pull them in transitively, which is fine), and `eas-cli`
(expo-doctor 1.20.4 fails a project with EAS CLI in its tree, and `npx eas-cli` inside the repo stops
under `strict-allow-scripts`: it is a pinned global install, see "Toolchain outside npm";
`npx-install` fails `npx eas-cli` in committed commands with or without this entry). An app that
decides otherwise edits its own list.

## Toolchain outside npm

| Tool | Verified | How it is pinned |
|---|---|---|
| Node.js | 26.4.0 (ships npm 11.17.0) | `.nvmrc` or `.mise.toml`; root `engines` `node >=22.18`, `npm >=11.17.0` with `engine-strict=true` (`check-deps-policy.mjs` fails a missing or open range: `engines`) |
| EAS Build | default SDK 57 images ship Node 22.23 with npm 10.9 (Expo's infrastructure page, read 2026-10-03) | set `build.<profile>.node` in `eas.json` to the project's Node so the install there (`npm ci --include=dev`) satisfies `engines`; not run on a worker by this skill | <!-- stack-pin-ignore -->
| EAS CLI | not a dependency (expo-doctor refuses it in a project) | a global install with the policy on the command line, because a global install ignores the project `.npmrc`: `npm install -g --min-release-age=7 --ignore-scripts eas-cli@<x.y.z>` after a `--strict-allow-scripts` run listed its install scripts (dtrace-provider and protobufjs on 2026-10-03, neither needed); `eas.json` `cli.version` holds the floor (eas-build-and-submit) |
| Xcode | 26.6 | selected through `DEVELOPER_DIR`, never `xcode-select` |
| JDK / Android SDK | 17 / compileSdk and targetSdk 36 | from React Native 0.86.3's Gradle catalog |

## When the app uses React Navigation 7 (fenced alternative)

Expo Router is the default. An app on the React Navigation 7 static API adds these rows (verified
2026-10-03 with `npm view`: 7.4.1 and 7.19.2 are the newest releases at least 7 days old, while
`@react-navigation/native` 7.5.0 and `native-stack` 7.20.0 of 2026-09-29 are younger; re-verify with
`npm view @react-navigation/native-stack@7 version time peerDependencies --json` before adding) and
keeps `react-native-screens` and `react-native-safe-area-context` as companions of
`@react-navigation/native-stack`:

```json
"@react-navigation/native": { "version": "7.4.1", "spec": "7.4.1", "install": "npm", "where": "app", "why": "not in the Expo map; v8 is not stable" },
"@react-navigation/native-stack": { "version": "7.19.2", "spec": "7.19.2", "install": "npm", "where": "app", "why": "the native stack", "companions": [
  { "package": "@react-navigation/native", "version": "7.4.1", "via": "install", "why": "a ^7.4.1 peer" },
  { "package": "react-native-screens", "version": "4.26.2", "via": "install", "why": "a >= 4.0.0 peer: alone, npm picks the newest release" },
  { "package": "react-native-safe-area-context", "version": "5.7.0", "via": "install", "why": "a >= 4.0.0 peer: alone, npm picks the newest release" } ] }
```

with `heldBack` entries `{ "package": "@react-navigation/native", "allowed": "^7\\.", "trigger": "a stable 8.0 that Expo documents" }`
(and the same for `native-stack`). The `implicitUse` of `react-native-screens` and
`react-native-safe-area-context` then names native-stack instead of expo-router.

## When multi-package

With npm workspaces, `where` names a place: `"app"` (the `dependencies` of every Expo app workspace
that uses it), `"dev"` (the root `devDependencies`), a workspace folder (`"packages/core"`) for a
library only that package uses, or a list of places (`["app", "packages/core"]`) for a JavaScript
library the apps and a shared package both import (one specifier everywhere, `lockstep`). Native
modules are always `"app"` rows: a shared package lists the ones its code imports as `"*"`
`peerDependencies`, every app that depends on it installs them with the same specifier, and the root
`overrides` pin each at the apps' version, plus `react` and `react-native` (Expo's monorepo guide:
duplicate React Native versions are not supported, and only one copy of a native module can be
compiled). Autolinking would find a native module in a shared package's `dependencies` (it resolves
recursively since SDK 54), but `npx expo install --check` and `expo-doctor` verify only an app's
direct dependencies, so that copy would escape the SDK set. Expo-managed packages are always `"app"`
rows too: `npx expo install` writes only into an Expo app.

## Re-verifying versions (they age)

Run these before trusting a row when the policy's `verified` date is more than a few weeks old (Expo
SDK 58 is expected soon after 2026-10-03):

```sh
npm view expo dist-tags --json                       # latest, sdk-57, next
node -p "require('expo/bundledNativeModules.json')['expo-router']"   # what npx expo install writes
curl -s https://api.expo.dev/v2/versions/latest | node -e "
  let s = ''; process.stdin.on('data', (c) => { s += c; }).on('end', () => {
    const v = JSON.parse(s).data.sdkVersions['57.0.0'];
    console.log(v.facebookReactNativeVersion, v.facebookReactVersion, JSON.stringify(v.relatedPackages));
  });"
npx expo install --check && npx expo-doctor          # in each Expo app
npm view <package> version time deprecated --json    # age (7-day policy) and deprecation
npm outdated                                         # at the root
```

`npx expo install --check` covers the `dependencies` and `devDependencies` of the app it runs in
(`jest-expo` and `eslint-config-expo` included). When multi-package, the root `devDependencies` are
outside every app's check; `check-deps-policy.mjs` closes that gap for the packages in Expo's module
map: `table-map` fails any policy row whose version the map's specifier does not accept (the
installed `expo/bundledNativeModules.json`, else the skill's SDK 57 copy), and `table-version`
fails a root pin that differs from its row. `typescript`, `jest` and `@types/react` are not in the
module map; compare them with the `relatedPackages` the `curl` command above prints.
