# The architecture contract and the layout config

The two repo-owned files the checkers read: `contracts/architecture.json` (the app's architecture facts)
and `rn-skills.config.json` (where the app keeps its folders). Both are optional for a single app: without
them the checkers apply the canonical defaults. Read this before recording an architecture decision, an
exception or a moved folder.

## Contents

- What the defaults are
- contracts/architecture.json
- Keys
- Keys other skills own that the checkers read
- Exceptions with reasons
- rn-skills.config.json
- Options of the checkers

## What the defaults are

`assets/architecture-defaults.json` in this skill holds the canonical architecture, equal to the canonical
`eslint.config.mjs` (typescript-and-lint-rules owns it; change both together):

- `srcFolders`: `app`, `features`, `ui`, `theme`, `core`, `services`, `stores`, `data`, `api`, `i18n`,
  `config`, `hooks` (shared cross-feature hooks), `canvas` (skia-canvas-rendering's canvas kit), `games`;
  files directly in `src/`: `app-env.d.ts`, `env.d.ts`, `tsconfig.json`, and the gate
  files `test-only.ts`, `test-only-api.ts`, `test-only-entry.ts`.
- `vendorSdks`, `vendorSdkFiles`, `portlessSdks`, `bannedPackages`: the lists in dependency-zones.md.
- `sdkPackagePatterns` (which packages need a decision): `expo-*`, `react-native-*`, `*-react-native`,
  `*-react-native-*`, `@react-native-*/*`, `@*/react-native`, `@*/react-native-*`, `@*/*-react-native`,
  `@*/*-react-native-*`; with `node_modules` installed, also any package that ships native code.
- `adapterFiles`: `{servicesDir}/*/*-adapter.ts`, `{dataDir}/**/*-adapter.ts`,
  `{dataDir}/**/*-sql-driver.ts`, `{dataDir}/**/*-save-store.ts`, each also with its
  `.ios`/`.android`/`.native`/`.web` platform files (written as `*-adapter{,.ios,.android,.native,.web}.{ts,tsx}`).
- `serverFiles`: `{routesDir}/**/*+api.{ts,tsx,js,jsx}` and `{routesDir}/+middleware.{ts,tsx,js,jsx}`;
  `serverPackages` (Expo packages server code may import): `expo-server`, `expo-router/server`.
- `nativeModulesDir`: `modules` (or `package.json` `expo.autolinking.nativeModulesDir`), the local Expo
  modules only an adapter imports.
- `gameFacing`: `{coreDir}/**`, `{uiDir}/**`, `{themeDir}/**`, `{i18nDir}/**`, `{srcDir}/canvas/**` (the canvas kit),
  `{servicesDir}/*/*-port.ts`.
- `testOnlyVariable`: `EXPO_PUBLIC_APP_VARIANT`: a `require()` it decides belongs in a `src/**/test-only.ts`
  gate (the comparison's literal and polarity are app-variants-and-environment's rule).
- `assetExtensions`: Metro's asset extensions plus Expo's (`heic`, `avif`, `db`) and `woff`, `woff2`,
  `lottie`, `riv`; `require()` of such a file is an asset, not code.
- `compositionRoot`: `{servicesDir}/services-context.tsx`, `{servicesDir}/create-device-services.ts`,
  `{servicesDir}/create-test-services.ts`, the root-kit registry `{servicesDir}/create-root-kits.ts`
  (app-startup-and-bootstrap's slots: it creates the optional kits' adapters, run once by `startApp`),
  and the data layer's device opener `{dataDir}/open-device-*.ts`
  (persistence-and-migrations' `open-device-database.ts` creates the SQL driver and the adapters that need
  the open database, such as a SQLite error log; the root layout calls it once).
- `nodeWorldFiles`: `app.config.ts`, `app.config.js`, `plugins/**`, `{scriptsDir}/**`.
- `frameworkPackages` (what `src/core` may not import): React, React Native and `react-native-*`, Expo and
  `expo-*`, `@shopify/*`, Zustand, React Navigation, react-intl and FormatJS, TanStack, react-hook-form,
  Sentry, and the common alternatives an app may run instead (i18next and react-i18next, Redux and
  `@reduxjs/*`, Jotai, MobX, `@legendapp/*`, Valtio, Recoil); with `node_modules` installed, also any
  package whose `package.json` lists `react` or `react-native` in `dependencies` or `peerDependencies`.

`{servicesDir}`, `{dataDir}`, `{scriptsDir}` and the other layout keys are filled from the layout below,
so moving a folder moves the globs too.

## contracts/architecture.json

Copy `templates/contracts/architecture.json` (and `architecture.schema.json` beside it for editor help).
Every list and map key **adds to** the defaults (`sdkPackagePatterns` and `assetExtensions` included); in
the four maps, a value of `null` removes a default entry. Unknown keys, wrong shapes, or an exception
without a reason stop the checker with exit 2 and the fix. (`testOnlyProductionVariant` is gone: the gate's
comparison belongs to app-variants-and-environment, whose variant names are fixed; delete the key.)

```json
{
  "$schema": "./architecture.schema.json",
  "srcFolders": ["navigation", "server"],
  "sdkPackagePatterns": ["@acme/*"],
  "vendorSdks": { "expo-notifications": "LocalNotificationsPort and PushPort", "expo-secure-store": "SecureStoragePort" },
  "vendorSdkFiles": {},
  "portlessSdks": { "react-native-svg": "draws vector icons; no side effect" },
  "bannedPackages": { "moment": "Format dates with the formatters in src/i18n." },
  "adapterFiles": [],
  "compositionRoot": [],
  "nodeWorldFiles": [],
  "serverFiles": ["src/server/**"],
  "allowedImports": [
    {
      "from": "src/features/task-detail/**",
      "to": "src/features/tasks/task-filter.ts",
      "reason": "Task detail shows the list filter until it moves to src/core."
    }
  ],
  "nonFeatureScreens": ["src/ui/crash-screen.tsx"],
  "testOnlyFolders": ["src/features/debug/", "src/services/test-hooks/", "src/services/debug-storage/", "src/stores/debug-overrides/"],
  "importTimeExempt": ["src/i18n/intl-polyfills.ts"],
  "gameFacing": ["src/services/game-host/hosted-game.ts"],
  "assetExtensions": ["glb"],
  "packages": []
}
```

## Keys

| Key | Type | Effect | Checker |
|---|---|---|---|
| `srcFolders` | list of names | extra top-level `src/` folders (each a shared layer) beside the defaults; for example `server` for server helpers in `src/server/` | layout `folders` |
| `sdkPackagePatterns` | names or name globs | more packages that count as SDKs (a vendor's scope, `@acme/*`); added to the defaults | boundaries `unclassified-sdk` |
| `vendorSdks` | `{ package: port }` | the package may be imported only by adapter files (subpaths count) | boundaries `vendor-sdk`, `unclassified-sdk` |
| `vendorSdkFiles` | `{ package: [globs] }` | only these adapter files may import it | boundaries `vendor-sdk` |
| `portlessSdks` | `{ package: why no port }` | any file may import it (UI building blocks, read-only facts) | boundaries `unclassified-sdk` |
| `bannedPackages` | `{ package: what instead }` | nobody imports it: architecture bans (a port or an API replaced the package); install bans live in `contracts/dependency-policy.json` `doNotAdd`, which this checker reads too | boundaries `banned-package` |
| `adapterFiles` | globs | more files count as adapters (may import SDKs; only the composition root imports them) | boundaries `vendor-sdk`, `adapter-import`; layout `composition-root` |
| `compositionRoot` | globs | more files may import adapters and `create-device-services` (a startup module the root layout calls; with React Navigation, the `App` component that mounts the services) | boundaries `adapter-import`; layout `composition-root`, `folders` |
| `nodeWorldFiles` | globs | more files run in Node (a config composer in `src/config/`, a script folder) | boundaries `node-world-import`, `node-import` |
| `serverFiles` | globs outside the routes folder | more server files: helpers the API routes share (`src/server/**`, also recorded in `srcFolders`) | boundaries `server-boundary` |
| `allowedImports` | `[{ from, to, reason }]` | reasoned exceptions to the zone rules; a route that renders an allowed target counts as rendering a screen | boundaries |
| `nonFeatureScreens` | globs | `*-screen.tsx` files allowed outside features | layout `placement` |
| `testOnlyFolders` | folders | reached only through the test-only entry (any other bundled value import, a route's re-export included, is `test-only-gate`; `import type` is fine); may keep a debug port and fake together, and may import fakes. Skills that add one say so: debug-menu-and-test-hooks (`src/features/debug/`, the debug services), design-visual-parity (`src/features/parity/`) | layout `placement`; boundaries `fake-import`, `test-only-gate` |
| `importTimeExempt` | globs | files allowed to work at import time (polyfill installers) | layout `import-time-work` |
| `gameFacing` | globs | more files every game may import: the seam game-session-host defines | boundaries `game-facing`, `game-to-game` |
| `assetExtensions` | extensions without the dot | more asset extensions, the ones the app added to `metro.config.js` `resolver.assetExts` (`glb`, `obj`, `bin`, `csv`); keep both lists equal | boundaries `test-only-gate` |
| `packages` | `[{ name, pure?, world?, exports? }]` | when multi-package: every folder under `packages/` | both (multi-package.md) |

Keep the vendor and ban lists equal to `VENDOR_SDK_PATHS` and `BANNED_PACKAGE_PATHS` in the ESLint
config: the checker covers resolved paths and subpaths, ESLint gives the editor squiggle.

## Keys other skills own that the checkers read

| File and key | Owner | Effect here |
|---|---|---|
| `contracts/dependency-policy.json` `doNotAdd` (`{ package: reason }`) | dependency-management | each package is a `banned-package` with the policy's reason; the contract's `bannedPackages` wins for the same name. A malformed file prints a `note:` (its own checker reports it) |
| `rn-skills.config.json` `devOnlyRequires` (`["./dev-tools/*"]`, `require()` specifier globs) | app-variants-and-environment | a matching `require()` is debug-bundle tooling, not test-only code: `test-only-gate` lets it pass outside the gate. Anything but a list of strings is exit 2 |

## Exceptions with reasons

`allowedImports` relaxes `feature-to-feature`, `layer-direction`, `ui-presentational`, `route-thin`,
`core-pure`, `game-to-game`, `game-facing` and `server-boundary` (server code importing an app file) for imports whose source matches `from` and whose target matches `to` (globs: a pattern
without `/` matches any path segment, one with `/` is anchored at the repo root, `**` crosses folders).
An exception is a decision: stop and ask, record the reason a reviewer can check later, and prefer moving
the shared piece down. Vendor SDK, SDK classification, fake, Node-world, test-only-gate and cycle rules have
no exceptions.

## rn-skills.config.json

An optional file at the repo root that moves the canonical folders for every skill's checkers (check-lib's
`resolveLayout`). Layout keys are repo-relative folders; `{srcDir}` inside a value is the resolved
`srcDir`:

```json
{
  "srcDir": "app-src",
  "routesDir": "app",
  "contractsDir": "qa/contracts",
  "workspaces": { "apps/mobile": { "routesDir": "apps/mobile/app" } }
}
```

| Key | Default | Used here for |
|---|---|---|
| `srcDir` | `src` | the app zones and the `@/*` alias check |
| `routesDir` | `{srcDir}/app` (or `app/` when only it exists) | routes zone, `route-file`, the root layout |
| `featuresDir`, `uiDir`, `themeDir`, `coreDir`, `servicesDir`, `storesDir`, `dataDir`, `apiDir`, `i18nDir`, `configDir` | `{srcDir}/<name>` | the zones, placement, adapter and composition-root globs |
| `testDir`, `mocksDir` | `test`, `__mocks__` | test helpers and root mocks |
| `scriptsDir` | `scripts` | Node world, the scripts folder rules |
| `contractsDir` | `contracts` | where `architecture.json` (and `dependency-policy.json`) is read |
| `devOnlyRequires` | none | `require()` globs of debug-bundle tooling (app-variants-and-environment documents the key) |

The tsconfig `paths` aliases come from `tsconfig.json` (with relative `extends`), per workspace when
multi-package.

## Options of the checkers

Both scripts take the repo root as an optional positional argument (default `.`) and:

| Option | Effect |
|---|---|
| `--contract <file>` | read another contract path (it must exist) |
| `--src-dir <dir>` | override `srcDir` |
| `--routes-dir <dir>` | override `routesDir` |
| `--json` | also print the problems as one JSON line |
| `--help` | usage and every rule |

Exit `0` pass (check-layout also prints `NOT APPLICABLE` when no app depends on `expo`), `1` problems,
`2` bad input (no `package.json`, no TypeScript or JavaScript files, a malformed contract).
The last line is always `RESULT: PASS` or `RESULT: FAIL (<n> problems)`.
