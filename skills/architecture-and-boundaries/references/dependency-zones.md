# Dependency zones: which code may import which

The one-way graph of an Expo app, the zone every file belongs to, what each zone may import, games,
what enforces each edge (the ESLint config and `check-boundaries.mjs`), how every SDK is classified, the
Node-world/app-world split, server code, assets and `require()`, the test-only gate and cycles. Read this
before adding an import across folders or a new SDK, and whenever an import is rejected.

## Contents

- The graph
- Zones and what they may import
- Games: the seam and nothing else
- What enforces each edge
- Why a checker on top of ESLint
- Node world and app world
- Neutral files: what Node code may import
- Server code
- SDKs: vendor, portless, unclassified, banned
- Local Expo modules
- Fakes are test code
- Assets and require()
- The test-only gate
- Cycles, parent imports, unresolved imports
- Exceptions
- Verified facts and how to re-verify them

## The graph

```
src/app (routes)            leaves: nothing imports them
   │ renders
src/features/<feature>      one feature each; never another feature
   │
shared layers               ui · theme · services · stores · data · api · i18n · config · hooks · canvas
   │                        (ui is presentational: no stores, data, api, services but port types)
src/core                    pure: imports only src/core

src/games/<game>            one game each; faces core, ui, theme, i18n, canvas, port types and the gameFacing
                            seam; never another game (rules/ and levels/ are pure)

app.config.ts · plugins/ · scripts/     Node world: may import neutral src/ files; nothing in src/ imports them
src/app/**/*+api.ts · +middleware.ts    server: core, api, config, data, port types; nothing bundled imports them
modules/<name>/                         local Expo modules: only their adapter imports them
test/ · __mocks__/                      tests only; never bundled
```

Dependencies point down. A file may import its own zone and the zones below it; a lower zone never
imports a higher one. The checker reads the zones from the layout (`rn-skills.config.json` can move
them) and the contract, so a moved `src/` keeps the same rules.

## Zones and what they may import

| From | May import | Never | Rule |
|---|---|---|---|
| routes (not `_layout`) | features, ui, theme, i18n, config, core, packages; it renders a feature screen (or a `nonFeatureScreens` file, or test-only code through the gate) or a `<Redirect>`, and calls only router hooks (`expo-router`) and hooks it imports from `src/features/` (no `useState`, `useEffect`, `useQuery`, `useMemo`, shared or local hooks) | stores, data, api, services; a `testOnlyFolders` file (through `TEST_ONLY` only) | `route-thin`, `test-only-gate` |
| routes `_layout` | the above + stores and services; the root `_layout` also the composition root (it mounts the providers) | | exempt from `route-thin` |
| anything outside routes, except tests (a route test in `src/features/<feature>/` renders the route files' default exports) | | a route file | `route-leaf` |
| features/<a> | its own feature, every shared layer, core | features/<b> | `feature-to-feature` |
| ui, theme, services, stores, data, api, i18n, config, hooks, canvas (and recorded `srcFolders`) | each other, core | a feature | `layer-direction` |
| ui | theme, i18n, config, core, port types | stores, data, api, other services files | `ui-presentational` |
| core | core (tests also `test/` helpers) | everything else, framework packages, Node built-ins | `core-pure` |
| games/<g>/rules, levels | core, own rules and levels (a rules test also its own game's other folders) | the rest | `core-pure` |
| games/<g> (everything else) | its own folder, core, ui, theme, i18n, canvas, port types, `gameFacing` globs (tests also any app code) | stores, services, features, data, api, config | `game-facing` |
| games/<g> (tests included) | | games/<h> | `game-to-game` |
| app code (all of `src/`) | | `scripts/`, `test/`, `__mocks__/` (runtime code), Node-world files, Node built-ins | `no-tooling-import`, `node-world-import`, `node-builtin` |
| any bundled file | | a vendor SDK outside its adapter; an SDK that is not classified (runtime code; tests are exempt); an adapter outside the composition root (`src/data/` may import its own driver adapters; the data opener `src/data/open-device-*.ts` is part of the composition root); `create-device-services` outside the root layout and the composition root | `vendor-sdk`, `unclassified-sdk`, `adapter-import` |
| runtime code (bundled, not a test) | | a `fake-*.ts` or `create-test-services` (other fakes, `createTestServices`, the test-only entry and `testOnlyFolders` may) | `fake-import` |
| Node code | neutral `src/` files by relative path with extension | aliases, extensionless paths, files that reach JSX or Expo/React Native modules | `node-import` |
| server (`+api`, `+middleware`, `serverFiles`) | core, api, config, data, port types, server files, `expo-server`, `expo-router/server`, Node built-ins | React Native and Expo runtime modules, routes, features, ui, theme, stores, games, adapters, local modules | `server-boundary` (adapters: `adapter-import`) |
| any bundled file | | a server file | `server-boundary` |
| any bundled file but an adapter | | a local Expo module in `modules/<name>/` (by path or package name) | `vendor-sdk` |

Tests beside the code follow their zone, with reliefs: they may import `test/` helpers, adapters
(`adapter-import`), fakes (`fake-import`), route files, unclassified SDKs and test libraries such as
`@testing-library/react-native` (the decision is forced where runtime code first imports an SDK), and
(tests of a game, of `src/ui` or of a route) app code their zone would not face. They may not import
Node-world files or server files (the app's TypeScript program has no Node types) or vendor SDKs (the same
as ESLint).

## Games: the seam and nothing else

The games plugin keeps each game in `src/games/<game-id>/`. A game is a guest in the app: the host
(game-session-host) creates it through one seam and hands it what it needs as values, so screens, stores
and navigation stay game-agnostic and a game can be removed by deleting its folder.

- **`game-to-game`**: code of one game never imports another game, tests included. Shared mechanics move to
  `src/core` (pure geometry, grids, the seeded RNG) or `src/ui`.
- **`game-facing`**: code of a game outside `rules/` and `levels/` imports only its own folder and the
  `gameFacing` globs. Defaults: `{coreDir}/**`, `{uiDir}/**`, `{themeDir}/**`, `{i18nDir}/**` (games render
  translated text through the same layer), `{srcDir}/canvas/**` (the canvas kit a game board draws and
  hit-tests with) and port types `{servicesDir}/*/*-port.ts` (a game receives a
  port as a value and needs its type). Never a store, `useServices()`, a feature, `src/data`, `src/api` or
  `src/config`: the host passes those in. Tests next to a game may drive it with app code.
- **The seam** is whatever files the host defines; game-session-host records them in the contract, for
  example `"gameFacing": ["src/services/game-host/hosted-game.ts"]`. A file matched by `gameFacing` is open to every game
  even when it sits under `src/games/`, so the seam can live there. A file directly in `src/games/` (a
  registry of the app's games) belongs to no game; games import it only through `gameFacing` too.
- `rules/` and `levels/` stay pure (`core-pure`): only `src/core` and their own game's rules and levels,
  never the seam, because generators, solvers and bots run them headless.

## What enforces each edge

| Boundary | ESLint (`eslint.config.mjs`, owned by typescript-and-lint-rules) | `check-boundaries.mjs` |
|---|---|---|
| routes are leaves | block 5-zones (runtime files; tests are left out): `import/no-restricted-paths` target `./src/!(app)/**/*` from `./src/app` | `route-leaf` (tests are left out too) |
| `src/core` imports only `src/core` | block 5-zones zone 2, and `PURE_IMPORTS` for `PURE` files | `core-pure` |
| the app never imports tooling, test helpers or mocks | block 5-zones zone 3 | `no-tooling-import` |
| `src/ui` is presentational | `UI_BOUNDARY` (stores, features, `services/*/*` except `*-port`) | `ui-presentational` (also data and api) |
| shared layers never import features; features never import each other | (none: the checker carries it) | `layer-direction`, `feature-to-feature` |
| games never import each other and face only the seam | `PURE_ALIAS` for rules and levels only | `game-to-game`, `game-facing` |
| routes stay thin | (none) | `route-thin` (imports, screen state and effects, renders a feature) |
| only the adapter imports its SDK | `VENDOR_SDK_PATHS` + the `ADAPTERS` exemption block (its globs miss `src/data/**/*-save-store.ts`) | `vendor-sdk` (subpaths and platform adapters too) |
| every SDK is classified (names and native code) | (none) | `unclassified-sdk` |
| only the adapter imports a local Expo module | (none) | `vendor-sdk` |
| server code stays apart from the app | (none; its `NODE_BUILTINS` ban also hits API routes, so the server files need an exemption there) | `server-boundary` |
| fakes stay in tests | (none) | `fake-import` |
| only the consent adapter asks for tracking | `ATT_IMPORT` banned + the file-exact `ATT_ADAPTER` block | `vendor-sdk` via `vendorSdkFiles` |
| banned packages | `BANNED_PACKAGE_PATHS` | `banned-package` (`bannedPackages` and the install policy's `doNotAdd`) |
| no Node built-ins in the app | `NODE_BUILTINS` in `RUNTIME_IMPORTS` | `node-builtin` |
| no Node-world file in the app, not even `import type` | the two TypeScript programs (the file fails to type-check) | `node-world-import` |
| Node code writes extensions | `NODE_IMPORT_EXTENSION` for `NODE_CODE` | `node-import` (also aliases and what the file reaches) |
| no parent-relative imports outside Node code | `PARENT_IMPORT` (Node code: `allowParent`) | `parent-import` |
| no import cycles | `import/no-cycle` (max depth 10) | `import-cycle` (names a loop through the test-only gate) |
| `require()` only for assets and in the gate | `@typescript-eslint/no-require-imports`, lifted for `src/**/test-only.ts`; eslint-config-expo 57.0.2 already passes it an `allow` list of Metro's asset extensions (and `json`), read with `npx eslint --print-config` on 2026-10-03 | `test-only-gate` (asset extensions, `__DEV__` debug tooling and other inclusion flags pass; the gate's literal comparison is app-variants-and-environment's `inclusion-gate`) |
| adapters only in the composition root; the services created once | (none) | `adapter-import`; check-layout `composition-root` (the root layout's `useState` initializer and `<ServicesProvider>`) |

**Changes the canonical ESLint config still needs** (typescript-and-lint-rules owns it; reported, not
made here, read on 2026-10-03): `VENDOR_SDK_PATHS` lacks `expo-file-system`, `expo-notifications` and
`expo-secure-store`, so ESLint lets any file import them and only `vendor-sdk` catches it. Adding
`expo-file-system` keeps persistence-and-migrations' file adapter lint-clean, because
`src/data/expo-file-system-database-files-adapter.ts` already matches the `ADAPTERS` glob
`src/data/**/*-adapter{,.ios,.android,.native,.web}.{ts,tsx}`. `ADAPTERS` still lacks
`src/data/**/*-save-store{,.ios,.android,.native,.web}.ts` (the save-document appendix's store). The
canonical `tsconfig.json` and `jest.config.js` have no `@/assets/*` alias yet (unit-and-component-tests owns
the Jest config).

Two verified pitfalls of `import/no-restricted-paths` (eslint-plugin-import 2.32.0 through
eslint-config-expo 57.0.2): a `target` glob must match **files** (`./src/core/**/*`, not
`./src/core`), and `basePath` must be the repo root (`import.meta.dirname` in the config), not the
working directory of the lint run.

## Why a checker on top of ESLint

ESLint's `no-restricted-imports` matches the text of a specifier. The checker resolves every import first
(relative paths, the `@/` alias and per-workspace tsconfig `paths`, workspace package names, platform
files such as `x.ios.ts`) and judges the file it lands on, so every spelling of an import is caught. It
also follows imports transitively (a config file that reaches `node:fs` two hops away), compares package
names (`expo-sqlite/kv-store` is `expo-sqlite`), names a cycle through the test-only gate, works across
workspaces, and runs without `node_modules` (in CI before install, or in a review).

## Node world and app world

Node-world code runs in Node: `app.config.ts` (Expo loads it through `@expo/require-utils`), local config
plugins in `plugins/`, and tooling in `scripts/` (run with Node type stripping, Node 22.18 or newer).
App-world code is everything under `src/`: Metro bundles it and Hermes runs it on iOS and Android.

- App code never imports a Node-world file, not even with `import type`: a type-only import still pulls
  the file into the app's TypeScript program (`src/tsconfig.json`, types `jest` only), where `process` and
  `node:fs` do not type-check (verified on 2026-10-03, TypeScript 6.0.3, in the reference SDK 57 app:
  `import type { AppLanguages } from '../../../scripts/i18n/app-languages.ts'` in a feature failed
  `tsc -p src/tsconfig.json` with TS2591 "Cannot find name 'node:fs'"). Move the shared type to a neutral
  file in `src/config/`.
- A file is Node world when it matches `nodeWorldFiles` (defaults `app.config.ts`, `plugins/**`,
  `scripts/**`, plus the contract's list), or when a config file reaches a Node built-in,
  `expo/config-plugins`, or Node's `process` global beyond `process.env` (`process.argv`, `process.exit`,
  `process.cwd()`).
- `process.env.EXPO_PUBLIC_*` is fine in app code: Metro inlines it (dot access only), and
  `src/app-env.d.ts` declares it for the app program.

## Neutral files: what Node code may import

`app.config.ts` and scripts may import app files to share one truth (the variant names, a pure
parser). Node loads those files itself, so each one, and everything it imports, must be:

- imported by a **relative path with its extension** (`./src/config/app-variant.ts`);
- free of tsconfig aliases and extensionless imports in its own imports;
- plain TypeScript with erasable syntax: no JSX (`.tsx`), no enums or parameter properties;
- free of React Native and Expo module imports (`expo-constants`, `react-native`, `expo-*`).
  `expo/config`, `expo/config-plugins` and `expo/metro-config` are Node-safe.

`node-import` reports each of these. Verified on 2026-10-03 with `npx expo config --type public` (Expo
SDK 57, expo 57.0.26, Node 26.4): `import { APP_NAME } from '@/config/app-name'` in `app.config.ts`
failed with "Cannot find module '@/config/app-name'"; `'./src/config/app-name'` failed with "Cannot find
module './src/config/app-name'"; `'./src/config/app-name.ts'` worked; and the same file importing
`expo-constants` failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (Node refuses to type-strip
`expo-modules-core/src/index.ts`).

## Server code

Expo Router API routes (`<name>+api.ts` anywhere under `src/app/`) and the root `src/app/+middleware.ts`
run on a server (EAS Hosting or another WinterCG host), and the native bundle leaves them out
(`_ctx.ios.js` and `_ctx.android.js` in expo-router 57.0.24 exclude `+api`, `+html` and `+middleware`).
They form the **server** zone, with helpers the contract records in `serverFiles` (`src/server/**`;
a glob inside the routes folder is ignored, since Expo Router would bundle any other file there as a route).

- `server-boundary` reports server code that imports a React Native or Expo runtime module (the
  `runtimePackages` list; `expo-server` and `expo-router/server` are the server's own packages) or a route,
  feature, ui, theme, store, game or local module file, and bundled code that imports a server file. A
  server file that imports an adapter gets `adapter-import`.
- `node-builtin`, `node-world-import`, `no-tooling-import`, the route rules, the SDK rules, `fake-import`,
  the test-only gate and `import-time-work` do not apply: none of that code ships in the app.
- `parent-import`, `unresolved-import` and `import-cycle` still apply: Metro bundles server code with the
  same resolver and the `@/` alias.

## SDKs: vendor, portless, unclassified, banned

Every SDK that runtime code imports must carry a decision. A package is an SDK when its name matches
`sdkPackagePatterns` (`expo-*`, `react-native-*`, `*-react-native`, `*-react-native-*`, `@react-native-*/*`,
`@*/react-native`, `@*/react-native-*`, `@*/*-react-native`, `@*/*-react-native-*`, plus the contract's own
`sdkPackagePatterns`), or, when `node_modules` exists, when its installed folder ships native code
(`expo-module.config.json`, a `*.podspec` or `android/build.gradle`; `react-native` and `expo` themselves
are left out). The name patterns cover `@stripe/stripe-react-native`, `@notifee/react-native`,
`lottie-react-native`, `posthog-react-native`, `@amplitude/analytics-react-native` and
`@datadog/mobile-react-native`; the native-code probe catches the rest once installed. Tests are exempt:
they import what their subject imports, and test libraries (`@testing-library/react-native`) are not app
SDKs. There are three decisions, each a map in the contract (`package: text`; `null` drops a default):

| Decision | Key | Who may import it | Rule |
|---|---|---|---|
| A side effect (device API, storage, network, notifications, system sheets, analytics, crash reporting) | `vendorSdks` (`package: its port`) | only its adapter file (subpaths count) | `vendor-sdk` |
| A UI building block or a read-only fact | `portlessSdks` (`package: why no port`) | any file | |
| Replaced by a port or an API | `bannedPackages` (`package: what instead`) | nobody | `banned-package` |
| No decision yet | | nobody: the first import fails | `unclassified-sdk` |

`unclassified-sdk` is what gives rule 5 its teeth: without it, a side-effect SDK the defaults do not list
(an Expo SDK 57 app with the canonical stack installed carries about fifteen: `expo-notifications`,
`expo-secure-store`, `expo-image-picker`, `expo-sharing`, `expo-clipboard`, `expo-web-browser`, ...) could
be imported from a screen and pass. Now the first import stops, and the developer decides once.

Default `vendorSdks` (equal to the ESLint `VENDOR_SDK_PATHS`):

| SDK | Port |
|---|---|
| `react-native-google-mobile-ads` | AdsPort and ConsentPort |
| `expo-iap` | PurchasePort |
| `expo-sqlite` (and `expo-sqlite/kv-store`) | SqlDriver (and a key-value adapter) |
| `react-native-audio-api` | AudioPort |
| `expo-haptics` | HapticsPort |
| `expo-network`, `@react-native-community/netinfo` | ConnectivityPort |
| `@sentry/react-native` | CrashReporterPort |
| `expo-tracking-transparency` | ConsentPort, and only `src/services/consent/*-consent-adapter.ts` (`vendorSdkFiles`) |
| `expo-file-system` | DatabaseFiles and file storage (persistence-and-migrations' `src/data/expo-file-system-database-files-adapter.ts`, media adapters) |
| `expo-updates` | UpdatesPort (ota-updates) |

`expo-file-system` is not yet in the canonical ESLint `VENDOR_SDK_PATHS`; add it there with the others
(typescript-and-lint-rules owns the file). A data-layer adapter keeps a name the `adapterFiles` globs
match (`*-adapter.ts`, `*-sql-driver.ts`, `*-save-store.ts`): named `src/data/expo-database-files.ts`, the
same file is ordinary data code and its import fails `vendor-sdk`.

SDKs that other skills ship a port for, but which stay out of the defaults until the canonical ESLint
`VENDOR_SDK_PATHS` lists them (the two lists are kept equal): an app that adopts the skill adds the line
to its contract `vendorSdks` and a `vendor(...)` line to the ESLint config in the same commit.

| SDK | Port | Adapter file (skill) |
|---|---|---|
| `expo-secure-store` | SecureStoragePort | `src/services/secure-storage/expo-secure-store-adapter.ts` (auth-and-secure-storage; already in the template contract) |
| `expo-auth-session` | OauthPort | `src/services/oauth/auth-session-oauth-adapter.ts` (auth-and-secure-storage) |
| `expo-apple-authentication`, `expo-crypto` | AppleSignInPort | the adapter in `src/services/apple-sign-in/` (auth-and-secure-storage) |
| `expo-sharing` | ShareSheetPort | `src/services/share-sheet/expo-sharing-share-sheet-adapter.ts` (data-export-and-restore) |
| `expo-document-picker` | FilePickerPort | `src/services/file-picker/expo-document-picker-file-picker-adapter.ts` (data-export-and-restore) |

Default `portlessSdks`: `expo-router`, `expo-image`, `expo-status-bar`, `expo-splash-screen`, `expo-font`,
`expo-constants`, `expo-device` (reads device facts: model, type, `isDevice`), `expo-application` (the
build's own version, build number and id), `expo-asset` (resolves and preloads bundled assets, like
`expo-font`), `expo-symbols`, `expo-glass-effect`, `@expo/ui` (SwiftUI and Jetpack Compose views),
`expo-linking` (the app's own URLs: `createURL`, `parse`, `useURL`), `expo-system-ui`,
`expo-localization` (the root layout reads the device locales once and language resolution takes them as
values, so tests pass locales in), `react-native-safe-area-context`, `react-native-screens`,
`react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`,
`@shopify/react-native-skia`, `@shopify/flash-list`, `react-native-keyboard-controller`. The reasons are
in `assets/architecture-defaults.json`.

Add a side-effect SDK to `vendorSdks` in the contract and to `VENDOR_SDK_PATHS` in the ESLint config; the
template contract starts with `expo-notifications` and `expo-secure-store`, which the canonical ESLint list
does not hold yet, so add both there in the same commit. ESLint's `paths` ban matches the bare module name
only, so `import Storage from 'expo-sqlite/kv-store'` in a feature passes lint (verified on 2026-10-03,
ESLint 9.39.5 with the canonical config: the bare `expo-sqlite` import in the same file was reported, the
subpath was not); the checker compares package names and reports the subpath. `expo-web-browser`
stays unclassified on purpose: it opens a system sheet, a side effect. `expo-linking` is portless for the
app's own URLs, but its `openURL` and `openSettings` leave the app the same way: a model hook calls them
through a port. The checker sees packages, not members, so that half of the decision is the reviewer's
(and React Native's own `Linking` is a member of `react-native`, which no rule tracks).

Debug-bundle tooling (`reactotron-react-native`, which matches `*-react-native`) is an SDK too: record it in
`portlessSdks` with the reason "debug-bundle tooling, required only behind `__DEV__`" when the app adopts it.

Banned by default (a port or an API replaced them): `axios` (the ApiClient in `src/api/`),
`@react-native-async-storage/async-storage` (`expo-sqlite/kv-store` or `expo-secure-store` behind a
port), `react-native-iap` (PurchasePort over `expo-iap`), `react-native-restart` (`reloadAppAsync` from
`expo`). An offline-only app bans more through the privacy-and-store-declarations profile.

The install policy bans too: when `contracts/dependency-policy.json` (dependency-management) exists, every
package in its `doNotAdd` map is a `banned-package` here, with the policy's reason, so the developer keeps
install bans in one list. `bannedPackages` in the architecture contract holds the architecture bans (a port
replaced the package) and wins over `doNotAdd` for the same name (`null` drops one). A malformed policy file
prints a `note:` and is left to dependency-management's checker.

A bare import named like a Node module (`buffer`, `events`, `url`, `util`) is that npm package when the
app's `package.json` declares it (a polyfill), and a Node built-in otherwise (`node-builtin`): Metro
cannot bundle Node's own modules, and an undeclared package that resolves only through another
package's dependencies breaks on the next install.

## Local Expo modules

A local Expo module (`npx create-expo-module --local`) lives in `modules/<name>/` at the app root, or in
the folder `package.json` `expo.autolinking.nativeModulesDir` names. Its files are zone `native-module`,
and the checker treats it like a vendor SDK: only an adapter imports it, by the alias
(`@/modules/<name>`, from `"@/modules/*": ["./modules/*"]`) or by the `name` in `modules/<name>/package.json`.
Any other bundled importer is `vendor-sdk`; a `../../modules/<name>` import is `parent-import` with the
alias as the fix. The checker does not read inside `modules/`.

## Fakes are test code

`fake-<concern>.ts` exists for tests. Runtime code that imports one (a store built on `createFakeClock()`,
a screen that "temporarily" uses the fake purchase port) ships test behaviour to users (`fake-import`).
Allowed importers: tests, `test/` helpers, `__mocks__/`, other fakes, `createTestServices()`, the
test-only entry, and files in a `testOnlyFolders` folder (a debug screen's simulated clock reaches users
only in development and preview builds, because `test-only-gate` holds every other bundled file to
`TEST_ONLY` for that folder).

## Assets and require()

Images, fonts, sounds and videos live in `assets/<kind>/` at the repo root and are required by their
file: `require('@/assets/images/empty-list.png')`, `useFonts({ Inter: require('@/assets/fonts/inter.ttf') })`.
The alias lives in three places, and all three must agree:

| Where | Entry | Why |
|---|---|---|
| root `tsconfig.json` `paths` | `"@/assets/*": ["./assets/*"]` | Metro and the checkers resolve aliases from it (the SDK 57 template ships it; the canonical tsconfig set does not yet) |
| `jest.config.js` `moduleNameMapper` | `'^@/assets/(.*)$': '<rootDir>/assets/$1'` **before** `'^@/(.*)$'` | Jest takes the first pattern that matches; after the catch-all, `@/assets/images/icon.png` maps into `src/` and the test fails with "Could not locate module ... mapped as <rootDir>/src/$1" |
| or, with no `@/` mapping in the Jest config (Expo's documented `preset: 'jest-expo'` setup) | `"@/assets/*"` listed **before** `"@/*"` in `tsconfig.json` `paths` | jest-expo turns the paths into mappers in declaration order; the SDK 57 template lists `"@/*"` first, so a test that requires an asset fails while tsc and Metro (longest prefix wins) pass |
| `src/tsconfig.json` `paths` (optional) | the same alias relative to `src/` | only static imports are type-checked; `require()` is typed `any` |

`check-layout` (`app-files`) reports a Jest config whose `'^@/(.*)$'` comes first, or that lacks the mapping,
whenever `tsconfig.json` declares the alias or code requires `@/assets/...`; and, when the Jest config names
a jest-expo preset and maps no `@/` key itself, a `tsconfig.json` whose `paths` list `"@/assets/*"` after
`"@/*"`. A local module alias (`@/modules/*`) follows the same places.
Metro bundles a file whose extension is in its `assetExts` (Metro's defaults plus Expo's `heic`, `avif`,
`db`, read in `@expo/metro-config` 57 on 2026-10-03); TypeScript has no module declaration for `*.png`,
so a static `import` does not type-check and `require()` (typed by `expo/types`) is the form. The SDK 57
default template (expo-template-default 57.0.28) maps `"@/assets/*": ["./assets/*"]` and requires every
image this way.

- `test-only-gate` ignores `require()` of a literal path ending in an asset extension (the list is
  `assetExtensions` in the defaults: images, video, audio, fonts, `db`, `lottie`, `riv`, ...). An app
  that adds extensions to `metro.config.js` `resolver.assetExts` (`glb`, `obj`, `bin`, `csv`) records the
  same ones in the contract's `assetExtensions`. A `require()` of a module still fails, a `.json` file
  included (import it statically).
- `require()` is typed `any`, so the strict lint set reports `no-unsafe-assignment` where the result is
  used directly (`source={require(...)}`); how the app types its assets is typescript-and-lint-rules'
  call.
- The import graph resolves asset paths like Metro: scale variants (`logo@2x.png`, `logo@3x.png`) and
  platform variants (`logo.ios.png`) count when `logo.png` itself does not exist.
- `../../assets/...` is a `parent-import`; `@/assets/...` without the alias resolves into `src/` and is an
  `unresolved-import` whose fix names the alias. `check-layout` reports a `src/assets/` folder.

## The test-only gate

Test-only code (a debug menu, simulated clock and connectivity, harness hooks) must never ship in a
production bundle. Metro inlines `process.env.EXPO_PUBLIC_*` during the transform, folds constant
conditions, and only then collects `require` dependencies, so a `require` in a branch that folds away
never enters the bundle.

```ts
// src/test-only.ts: the only file allowed to require() code (debug-menu-and-test-hooks owns it)
import type * as TestOnlyEntry from './test-only-entry';

/** Typed from the entry itself, so no hand-written API file can drift from it. */
export type TestOnlyApi = typeof TestOnlyEntry;

export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
```

Verified on 2026-10-03 in an Expo SDK 57 app with the canonical stack installed (expo 57.0.26, `@expo/cli`
57.0.27, Node 26.4):
six gates side by side, each requiring an entry with its own sentinel string, exported with
`APP_VARIANT=<v> EXPO_PUBLIC_APP_VARIANT=<v> npx expo export --platform <p> --no-bytecode --clear`
(production on iOS and Android, development on iOS):

| Gate | Production bundle | Development bundle |
|---|---|---|
| `=== 'production' ? null : require(...)` | dropped | kept |
| `!== 'production' ? require(...) : null` | dropped | kept |
| `=== 'development' ? null : require(...)` (inverted) | **kept** | dropped |
| `const IS_TEST_BUILD = ... !== 'production'` in the same file, then `IS_TEST_BUILD ? require(...) : null` | dropped | kept |
| `IS_TEST_BUILD` imported from another file | **kept** | kept |
| `isTestBuild() ? require(...) : null` (a function in the same file) | **kept** | kept |

So an imported constant or a function call keeps the module, and so does any polarity other than "not
production": the inverted gate even strips the code from development builds and ships it to the store.
A same-file constant folds, but app-variants-and-environment still asks for the literal inline, because
the next refactor moves that constant into a shared file.

One rule, one owner: **app-variants-and-environment** owns the comparison itself (its `inclusion-gate`
rule checks the literal, the polarity and every other inclusion flag, and its bundle check proves the
strip); **debug-menu-and-test-hooks** owns the gate file and what the entry exports. `check-boundaries.mjs`
(`test-only-gate`) keeps the import side, so test-only code has exactly one way in:

- `require()` of code outside a `src/**/test-only.ts` gate is a problem, except the forms
  app-variants-and-environment sanctions: an asset; debug-bundle tooling (a specifier naming Reactotron or
  why-did-you-render, a glob in `rn-skills.config.json` `devOnlyRequires`, or a package required under a
  `__DEV__` condition: Reactotron's documented `if (__DEV__) { require('./reactotron-config'); }`, at any
  position in that block or a block nested in it); and a
  `require()` decided by another `EXPO_PUBLIC_*` inclusion flag
  (`process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true' ? require(...) : null`). A `require()` decided by
  `EXPO_PUBLIC_APP_VARIANT` outside the gate gets its own message: it is a second way into test-only code.
- a `require()` in the gate with no condition at all (it ships the entry in every bundle);
- an import of `test-only-entry` by anything other than its gate in the same folder;
- a value import of a file in a contract `testOnlyFolders` folder from bundled code other than the entry and
  those folders (`import type` is erased and fine). The common form is a route,
  `export { DebugScreen as default } from '@/features/debug/debug-screen'`: Expo Router bundles every route,
  so the screen and the fakes it imports ship to the store. The route imports the gate instead and renders
  `TEST_ONLY?.DebugScreen`, redirecting when it is `null`.

An imported constant (`IS_TEST_BUILD ? require(...) : null`) outside the gate is reported here as a
`require()` in app code and by app-variants-and-environment as a gate that does not fold; one fix, moving it
behind the gate, satisfies both.

Code the entry reaches is test-only itself: it imports a member from that member's own file, never the
gate or a helper that imports the gate, or the gate's `require()` closes a loop (`import-cycle` names it
"through the test-only gate"). The variant names and the bundle proof belong to
app-variants-and-environment; what the entry exports belongs to debug-menu-and-test-hooks.

## Cycles, parent imports, unresolved imports

- `import-cycle`: files that import each other in a loop through value imports (`import type` and
  `export type` are erased, so they never form a cycle; `require()` and dynamic `import()` count). A
  cycle makes a value `undefined` when a module reads it during its own load. Break it by moving the
  shared piece, usually a type, into its own file that both import.
- `parent-import`: no `../` outside Node code. The same folder is `./x`; any other folder is `@/...`.
  Node code may use `../` because Node cannot read the alias.
- `unresolved-import`: a relative or alias import that points to no file (the probe tries the path, the
  extensions `.ts .tsx .js .jsx .mjs .cjs .json`, their `.ios`/`.android`/`.native`/`.web` variants, and
  `index.*`).

## Exceptions

A deliberate exception to `feature-to-feature`, `layer-direction`, `ui-presentational`, `route-thin`,
`core-pure`, `game-to-game`, `game-facing` or `server-boundary` (server code importing an app file) is an
entry in `allowedImports` with `from`, `to` (globs)
and a `reason` (required, the checker stops with exit 2 without it). Exceptions are architecture
decisions: stop and ask first, and prefer moving the shared piece down. Vendor, SDK classification, fake,
Node-world, gate and cycle rules have no exceptions: their fix is a decision in the contract
(`vendorSdks`, `portlessSdks`, `testOnlyFolders`) or a move.

## Verified facts and how to re-verify them

| Fact | Verified | Re-verify |
|---|---|---|
| Files in `src/app` ship as routes | 2026-10-03, SDK 57, iOS and Android exports | src-layout-and-placement.md, "Route files are routes" |
| `app.config.ts` cannot use `@/`, extensionless imports, or files that import Expo modules | 2026-10-03, expo 57.0.26, Node 26.4 | add the import, run `npx expo config --type public` |
| The two production-polarity gates strip test-only code; an inverted gate, an imported constant and a function call keep it; a same-file constant folds | 2026-10-03, expo 57.0.26, iOS and Android production exports | plant the six gates of "The test-only gate", export with `--no-bytecode --clear`, `LC_ALL=C grep -a -c <sentinel> dist/_expo/static/js/<platform>/*.js` |
| Expo Router bundles every file in `src/app` except `+api`, `+html`, `+middleware` on iOS and Android | 2026-10-03, expo-router 57.0.24 | read `node_modules/expo-router/_ctx.ios.js` and `_ctx.android.js` |
| An API route that imports `node:crypto` fails the app program (TS2591) and passes the root program | 2026-10-03, TypeScript 6.0.3, an Expo SDK 57 app with the canonical stack installed | add `src/app/api/x+api.ts`, run both `tsc -p` |
| The SDK 57 template maps `@/assets/*` and requires its images | 2026-10-03, expo-template-default 57.0.28 | `npm pack expo-template-default@<version>`, read `tsconfig.json` and `src/` |
| Jest needs `'^@/assets/(.*)$'` before `'^@/(.*)$'` | 2026-10-03, jest 29.7.0, jest-expo 57.0.5 | a component test that requires `@/assets/images/icon.png`, both orders |
| Without an `@/` mapping in the Jest config, jest-expo builds `moduleNameMapper` from `tsconfig.json` `paths` in declaration order (the file itself; `extends` is not read), and Jest puts the config's own keys first | 2026-10-03, jest 29.7.0, jest-expo 57.0.5: read in `src/preset/withTypescriptMapping.js` and jest-config's `mergeOptionWithPreset`, then run: `"@/*"` first failed with "Could not locate module @/assets/images/icon.png mapped as", `"@/assets/*"` first passed | `module.exports = { preset: 'jest-expo/ios' }`, a `babel-preset-expo` config, and a test that requires `@/assets/images/icon.png`, both `paths` orders |
| Local modules live in `./modules` unless `expo.autolinking.nativeModulesDir` says otherwise | 2026-10-03, expo-modules-autolinking 57.0.13 | read `build/commands/autolinkingOptions.js` |
| `import type` of a Node file fails the app program | 2026-10-03, TypeScript 6.0.3, the reference SDK 57 app (TS2591 on `node:fs`) | `npm run typecheck` after adding one |
| ESLint `paths` misses `expo-sqlite/kv-store` | 2026-10-03, ESLint 9.39.5, the canonical `eslint.config.mjs` | lint a feature that imports the subpath and the bare name |
