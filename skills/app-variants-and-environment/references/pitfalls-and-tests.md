# Pitfalls, tests and checker rules

What goes wrong with variants and environment variables, how to test the setup, and what every checker
rule means. Facts verified on 2026-10-03 with Expo SDK 57 (expo 57.0.26) unless a row says otherwise.

## Contents

- Pitfalls: symptom, cause, fix
- Test recipes
- check-variants rules
- check-env rules
- check-variant-bundle rules
- Options and rn-skills.config.json keys
- When multi-package

## Pitfalls: symptom, cause, fix

| Symptom | Cause | Fix |
|---|---|---|
| A production bundle shows the debug menu or says it is a development build | a warm Metro cache from a development export (verified on SDK 57) | key `cacheVersion` on the public values (`templates/metro.config.js`); never rely on `--clear` |
| The production bundle still contains the test-only module after a clean export | the gate is an imported constant or a function call (verified on SDK 57) | the literal comparison in one expression in the gate file |
| A feature works in Jest and the dev client but is empty in TestFlight or Play | the code reads `process.env.NAME` without `EXPO_PUBLIC_`, by brackets or by destructuring; Jest reads `process.env` at run time, release bundles only get inlined `EXPO_PUBLIC_*` | read `process.env.EXPO_PUBLIC_NAME` with dot access in `src/config/` |
| `Error reading Expo config ... EXPO_PUBLIC_APP_VARIANT= must equal APP_VARIANT=production` | a build or script exported only `APP_VARIANT` | export both (`variantEnv(variant)` gives the pair) |
| `... are not set: production bundles and EAS builds name their variant` during `npx expo export` or `eas update` | no variant in the environment of a production bundle | set both variables; for `eas update` create them in the EAS environment |
| An OTA update changed the app's behaviour to development (badge, API) | `eas update --environment production` ran without `APP_VARIANT`/`EXPO_PUBLIC_APP_VARIANT` in the EAS environment, with an older resolver that defaulted silently | the variables in every EAS environment; the resolver template refuses an unset variant when `NODE_ENV=production` |
| Installing the preview build replaced the store app | both variants share the bundle id or package | `.preview` suffix (`variantIdentity`) |
| A deep link or QR code opens the wrong build | two installed variants register the same scheme, or the dev client's `exp+<slug>` scheme is in every variant | a scheme per variant; `addGeneratedScheme: variant === 'development'` |
| `npx expo run:ios` built the old variant | `ios/` was generated for another variant and `expo run` compiles it as it is | `npx expo prebuild --clean` with the same two variables first |
| The name or id is right in `expo config` but wrong in a local Release build | the shell lost the variables between prebuild and the native build; the embedded config step and Metro run again during the build | export both for the whole run; the build skills pass one environment to every step |
| A token appeared in `Constants.expoConfig` or a plugin's options in the app | the config passed a secret-named variable into `extra` or plugin options; the whole public config is embedded | read the token in the tool's own environment; rotate it |
| `eas build` resolved the wrong values locally | EAS CLI does not load `.env` files for config resolution | put the variables in the profile `env` or the EAS environment |
| `NODE_ENV=staging npx expo export` built with production values | `expo export` forces `NODE_ENV=production` (Expo docs) | variants and EAS environments, not `NODE_ENV` |
| knip or `expo-doctor` fails in CI with "are not set" | a resolver that throws whenever `CI` is set (not this template) | the template refuses an unset variant only for `NODE_ENV=production` and `EAS_BUILD=true` |
| `npx expo start --no-dev --minify` fails with "are not set" | `--no-dev` sets `NODE_ENV=production` (`@expo/cli` 57.0.27, verified 2026-10-03) | export the variant pair for it, like any production bundle |
| `eas submit` looked up or created the App Store Connect app for `com.example.tasks.dev`, or uploaded to the wrong Play package | a standalone `eas submit` (and `eas metadata`) evaluates the config without the build profile env (eas-cli 24.10.0 `commands/submit.js`), so the resolver returns development | export `APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production` for it, and pin `submit.production.ios.ascAppId`/`bundleIdentifier` and `android.applicationId` (`eas-build-and-submit`); `eas build --auto-submit` already passes the build's id |
| `npx expo config` or prebuild fails with `Failed to resolve plugin for module "expo-dev-client"` | the config names a plugin whose package is not installed (`check-variants` evaluates the config without resolving plugins, so `variant-config` checks package.json) | `npx expo install expo-dev-client` (the template's development profile builds the dev client) |
| An OpenAI or other LLM bill grows with traffic the app never sent | the key shipped in the bundle (`EXPO_PUBLIC_OPENAI_API_KEY`) and was lifted from it | rotate the key; move the call into an API route that reads `OPENAI_API_KEY` from a sensitive EAS variable |
| The dev or preview build crashes on App Group, iCloud or keychain access, or Xcode says an embedded binary's bundle id "is not prefixed with the parent app's bundle identifier" | entitlement identifiers or an extension id were hard-coded to the production id | derive them from `variantIdentity(BASE, variant).appId` (variant-matrix.md, services keyed by the app id) |
| Gradle fails with `No matching client found for package name 'com.example.tasks.dev'` | `google-services.json` has no client for the variant's package | one Firebase app per id, chosen per variant through an EAS file variable (variant-matrix.md) |
| `npx expo prebuild` or an EAS Build stops with `ENOENT ... ./assets/icons/preview/icon.png` | the config names per-variant icon files that were never drawn | move the store icons into `assets/icons/production/` and run `make-variant-icons.mjs` (`variant-icon` reports it first) |
| Every developer's `expo start` builds the store identity, or a local prebuild writes the production bundle id | a committed `.env` sets `APP_VARIANT`/`EXPO_PUBLIC_APP_VARIANT`; Expo CLI loads it for every local command | remove the lines (`variant-env-file`, and `variant-resolve` with the env files loaded) |
| Every `eas build` warns that `APP_VARIANT, EXPO_PUBLIC_APP_VARIANT` are "defined in both the build profile env configuration and the environment on EAS" | rule 4 sets them in both places on purpose; EAS CLI 24.10.0 uses the profile's values | nothing, while the values are equal |
| An OTA update from CI carries a stale bundle, or public values from EAS are `undefined` in it | `eas update` ran without `--environment`: in CI EAS CLI does not prompt, loads no EAS variables, loads `.env` files and keeps the Metro cache | always `eas update --environment <variant>` |
| `npx expo start` returns 404 for `/api/...`, or `expo export` says "Skipping export for API routes" | `web.output` is not `"server"` (SDK 57) | set `web.output: "server"` when the first API route arrives (secrets.md) |
| An EAS Build stops while Metro loads `metro.config.js` (a `SyntaxError` in `public-env-cache-version.ts`, or `ERR_UNKNOWN_FILE_EXTENSION`) | the profile, or a shared `base` it extends, pins `"node"` below 22.18 (SDK 55 images used 20.19.4), so Node cannot strip the `.ts` types | drop the pin (SDK 57 images ship 22.23.1) or pin 22.18 or newer (`eas-profile` reports it) |
| The development and preview builds look the same as Android 13+ themed icons | `android-monochrome.png` badges with the same alpha mask (themed icons ignore colour), as an older `make-variant-icons` drew them | `make-variant-icons.mjs . --force` (the preview band gets transparent stripes; `icon-badge`) |

## Test recipes

- **Resolver and reader (Jest, fast):** `npx jest src/config scripts/metro --ci --maxWorkers=2`. The
  canonical test covers every row of the resolver contract and a fast-check property (every string
  outside the three names throws). `current-app-variant.test.ts` sets the variable on the real
  `process.env` object and restores it, which works because Jest reads `EXPO_PUBLIC_*` at run time.
- **The config per variant:** `APP_VARIANT=<v> EXPO_PUBLIC_APP_VARIANT=<v> npx expo config --type public`
  for the three variants, and once with `APP_VARIANT=staging EXPO_PUBLIC_APP_VARIANT=staging` (must
  fail). `check-variants` runs the same evaluations without Expo CLI (Node type stripping) in under a
  second.
- **The strip:** the bundle proof in [stripping-test-code.md](stripping-test-code.md).
- **Side by side on devices:** install the three builds on one named simulator or emulator and list
  them (`xcrun simctl listapps <udid>`, `adb -s <serial> shell pm list packages`); open a link per
  scheme and confirm the right app opens.

## check-variants rules

| Rule | Fails when | Fix |
|---|---|---|
| `variant-config` | there is only a static `app.json`; an `app.json` sits beside `app.config.ts`; the config throws or returns nothing for a variant; a plugin package is neither in package.json nor installed, or a local plugin file does not exist | one `app.config.ts` (`templates/app.config.ts`) that evaluates for all three; `npx expo install <package>` (`expo-prebuild-and-config-plugins` `plugin-entry` reports the same missing package; one install fixes both) |
| `variant-resolve` | the config evaluates with an unknown name, with `APP_VARIANT` but no `EXPO_PUBLIC_APP_VARIANT`, with no variant and `NODE_ENV=production`, or with no variant and `EAS_BUILD=true`; or no variant locally, with the env files git would commit loaded the way Expo CLI loads them (`.env.development.local`, `.env.local`, `.env.development`, `.env`), builds something other than development | resolve through `resolveAppVariant`; no variant in a committed env file |
| `variant-id` | an id is missing or invalid on its platform (Android: Expo's rules, including no Java-keyword segment such as `new`); a testing variant shares the production id, does not extend it by one segment, or shares the other testing variant's id | `variantIdentity(BASE, variant).appId` for iOS and Android |
| `variant-name` | two variants share a name; the production name carries `(Dev)`, `(Preview)` or similar | `variantIdentity(...).name` |
| `variant-icon` | an icon file a variant names does not exist (prebuild and EAS Build stop with ENOENT); a testing variant has no icon or the production icon (per platform), or its files are byte-identical copies | production's store icons in `assets/icons/production/`, then `make-variant-icons.mjs` draws the badged development and preview copies |
| `variant-scheme` | two variants register the same scheme; preview or production keeps the dev client's generated scheme | `variantIdentity(...).scheme`; `addGeneratedScheme: variant === 'development'` |
| `eas-profile` | a variant profile is missing; a profile's `APP_VARIANT`, `EXPO_PUBLIC_APP_VARIANT` or `environment` disagrees with its variant (through `extends`); a platform `env` overrides the variant; a non-development profile sets `developmentClient`; an `extends` chain is broken; a shared base sets a variant, an `environment` or `developmentClient` that a profile built from it contradicts; any profile pins `"node"` below 22.18 (`"22.x"` and `"22"` pass: they take the newest 22); SKIP while there is no eas.json (`eas-build-and-submit` creates it). A `note:` line, not a problem, when `submit.production` pins no store ids (an empty `"production": {}` or a missing `ios`/`android` block included) | merge `templates/eas.json` |
| `secret-config` | a secret-named variable's value reaches the public config (canary run), an `extra` key is named like a secret, or a public-config string looks like a secret | keep secrets in the tool's environment; rotate what shipped |
| `metro-cache-key` | no Metro config; loaded with `expo/metro-config` stubbed, `cacheVersion` is unset, not a string, unchanged when only `EXPO_PUBLIC_RNSKILLS_PROBE` changes, or equal for two variants; a config that cannot be loaded is read statically instead (with a `note:`) | `templates/metro.config.js` |

**Shared base profiles.** Expo's eas.json docs show a `base` profile (`node`, `env`, `ios.image`) that
`development`, `preview` and `production` extend. `eas-profile` treats any profile that another one
names in `extends`, and whose name is not a variant, as such a base: nobody builds it, so it needs no
`APP_VARIANT` or `environment` of its own. It may hold what every variant shares (a Node version, an
image, a public API host), and fails only when it sets `APP_VARIANT`, `EXPO_PUBLIC_APP_VARIANT`,
`environment` or `developmentClient: true` that a profile built from it contradicts: the child
overrides it today, and the next child that forgets inherits the wrong variant. A variant profile
that another extends (`"simulator": { "extends": "development" }`) stays a variant profile.

## check-env rules

| Rule | Fails when | Fix |
|---|---|---|
| `public-env-secret` | an `EXPO_PUBLIC_*` name is secret-looking, a paid or LLM provider key included (in code, API routes and `serverDirs` too, `src/**/*.d.ts`, the app config and the local files it imports, any `.env*` file, eas.json), or its value looks like a secret (OpenAI, Anthropic, Stripe live or test, ...) | remove it from the app, call an API route; `publicEnvAllow` only for names public by design |
| `env-reader` | app code outside the config folder (`src/config/`, or the layout's `configDir`) reads `process.env.EXPO_PUBLIC_*`, except a literal comparison in the same ternary as a `require()` (the gate, or any inclusion flag such as `EXPO_PUBLIC_STORYBOOK_ENABLED === 'true' ? require(...) : null`); the same flag deciding a `require()` from an `if` block or a separate `const`; any app code reads a non-public name, uses brackets, destructures, spreads or passes `process.env`. API routes (`<routes>/**/*+api.ts`), `<routes>/+middleware.ts` and the `serverDirs` folders are server code and exempt; a `+api` file outside the routes folder is app code | dot access in `src/config/`; for an inclusion flag, the literal comparison at the `require()` (an imported constant does not strip code) |
| `variant-reader` | app code reads `extra.appVariant` from expo-constants | `currentAppVariant()` |
| `inclusion-gate` | a `require()` is included by a condition that stands in for the variant (whole words: `IS_TEST_BUILD`, `isDebug`, `isPreview`, `IS_STORE_BUILD`, `__DEV__`, a `'production'` literal) without the literal comparison in the same expression; the literal comparison guards an `if` block instead of a ternary (own message); a `require()` is decided by an imported constant or helper that reads an `EXPO_PUBLIC_*` value (`STORYBOOK_ENABLED` from `src/config/`). Not its business: `Platform.OS`, `shouldRestore`, `showPreview`, `releaseNotes`; Reactotron and why-did-you-render; a package specifier behind `__DEV__` (`@tanstack/react-query-devtools`); specifiers in `devOnlyRequires` | the gate's ternary form; `devOnlyRequires` for debug-bundle tooling |
| `server-import` | app code imports a module from a `serverDirs` folder (type-only imports are fine) | call the server through an API route; move shared code out of the server folder |
| `secret-eas-env` | an eas.json `env`, `ios.env` or `android.env` entry has a secret-looking name or value | an EAS secret variable |
| `secret-env-file` | an env file that git would commit holds a value for a secret-looking name or a secret-looking value | empty it; keep values in `.env.local` or EAS |
| `variant-env-file` | an env file that git would commit sets `APP_VARIANT` or `EXPO_PUBLIC_APP_VARIANT` (Expo CLI loads it for every `start`, `export` and `prebuild`) | delete the line, or keep it commented in `.env.example`; the variant comes from the command, the profile or the EAS environment |
| `secret-ignored` | there is no `.gitignore`, or it does not ignore `.env*.local`, signing files, `credentials.json` (local credentials) or a key file eas.json names | add the pattern the message gives |

**What counts as app code** (shared with `check-variant-bundle`'s sentinel and gate search): the
`srcDir` (default `src/`), the routes folder when it lies outside it (Expo Router's root `app/`, which
check-lib detects when `src/app/` does not exist), the app entry (package.json `"main"` when it is a
local file, else `index.*` or `App.*` in the app folder), and every local file those reach through
`import`, `export ... from`, `import()` and `require()`, aliases resolved, wherever it lives: a root
`components/` folder that a route imports is scanned, an unused one is not (it never ships). With
`"srcDir": "."` the whole app folder is app code except Node tooling: `*.config.*` and `*.setup.*`
files at its top, `scripts/`, `test/`, `__mocks__/`, `plugins/` (local config plugins), the e2e and
contracts folders, and other workspaces. No app code at all is exit 2, never a pass on configs alone.

Scanning skips tests (`*.test.*`, `__tests__/`), `node_modules`, generated native folders, build
output, agent skill folders (`.agents/`, `.claude/`, `skills/`, ...) and any folder holding a
`SKILL.md`: installed skills carry planted bugs on purpose.

**Limits (heuristics, stated so nobody over-trusts a pass).** `inclusion-gate` reads the statement
around each conditional `require()` and decides "stands in for the variant" from words and literals,
so an exotic gate form (a condition built in another function, a computed specifier) can slip
through or be misread; the bundle proof (`check-variant-bundle`) is the backstop. A `Platform.OS`
ternary is deliberately not its business. The secret-name list leaves out a bare `KEY`, so a public
token whose name holds TOKEN (a Mapbox `pk.` token) needs `publicEnvAllow`, and a secret named
without any listed word is caught only by its value pattern.

## check-variant-bundle rules

| Rule | Fails when | Fix |
|---|---|---|
| `bundle-sentinel` | a production bundle contains a sentinel; a development or preview bundle lacks one; the app has a test-only gate (`src/test-only.ts`, any `test-only.ts` in the app code, or a `require()` behind the literal variant comparison, a root `app/` route included) but no sentinel is known. SKIP while the app has no test-only gate (`debug-menu-and-test-hooks` creates it); `bundle-secret` still runs | the literal gate and the Metro cache key; for a testing bundle, a reachable entry; export a sentinel from the test-only entry |
| `bundle-secret` | a bundle contains a secret-looking value (the value list in secrets.md, LLM keys included), or the value (8 characters or more) of a secret-named variable from an `--env-file`. In bytecode the patterns run without word boundaries: Hermes packs its string table and shares characters between strings (a planted `sk-proj-` key sat inside `...RenderMask-proj-...` in an SDK 57 export) | remove the source, export again, rotate |

Exit 2 (bad input): no `--bundle`, an unknown `--variant`, a folder without `*.js`, `*.hbc`,
`*.jsbundle` or `*.bundle` files, or a missing `--env-file`.

## Options and rn-skills.config.json keys

| Script | Option | Meaning |
|---|---|---|
| all | `[repo-root]` (positional, default `.`), `--json` | the repo; also print the problems as JSON |
| check-variants | `--app-dir <dir>`, `--config <file>`, `--eas <file>` | the app folder (default: the root, or the one workspace with an app config); the app config and eas.json inside it |
| check-env | `--app-dir <dir>` | where eas.json and the `.env*` files live (same default) |
| check-variant-bundle | `--bundle <path>`, `--variant <name>`, `--sentinel <text>` (repeatable), `--env-file <file>` (repeatable) | what to check and against what |

Layout keys in `rn-skills.config.json` that `check-env` and `check-variant-bundle` read (check-lib's
layout, honoured by every checker):

| Layout | What to set | What is scanned |
|---|---|---|
| The canonical one: `src/` with routes in `src/app/` | nothing | `src/`, the entry, and what they import |
| Routes in a root `app/`, other code in `src/` | nothing (`app/` is detected when `src/app/` does not exist) | `src/`, `app/`, the entry, and what they import (a root `components/`) |
| Everything at the root (`app/`, `components/`, `hooks/`, `config/`, as older Expo templates had it) | `{ "srcDir": "." }`, which also makes `config/` the reader folder | the whole app folder minus tooling (see "What counts as app code") |
| Routes elsewhere | `{ "routesDir": "mobile/app" }` | that folder too, plus `+api` and `+middleware` files in it as server code |

Without `"srcDir": "."`, a root layout is still scanned through the routes and the imports, but the
reader folder stays `src/config/`, so a root `config/env.ts` is reported by `env-reader`: set the key.

Other keys in the optional repo file `rn-skills.config.json`:

```json
{
  "publicEnvAllow": ["EXPO_PUBLIC_MAPBOX_TOKEN"],
  "devOnlyRequires": ["./dev-tools/*"],
  "serverDirs": ["src/server"],
  "testOnlySentinels": ["TASKS_TEST_BUILD_ONLY"]
}
```

- `publicEnvAllow` (check-env): `EXPO_PUBLIC_*` names that look secret but are public by design; the
  review records why.
- `devOnlyRequires` (check-env): globs matched against `require()` specifiers of debug-bundle-only
  tooling that `inclusion-gate` leaves alone (Reactotron and why-did-you-render are built in).
- `serverDirs` (check-env, default none): repo-relative folders of server-only code, the helpers
  Expo Router API routes import (an LLM client, a payment wrapper). They are exempt from `env-reader`
  like `+api` files (server code reads its real `process.env`, secrets included), still checked by
  `public-env-secret`, and app code may not import them (`server-import`). Anything that is not a
  list of repo-relative folders is exit 2.
- `testOnlySentinels` (check-variant-bundle): sentinels besides the `export const *SENTINEL*` strings
  found in the app source.

## When multi-package

One Expo app per workspace (`apps/mobile`): `check-variants` and `check-env` find the one workspace
whose folder holds an app config (from `package.json` `workspaces`, through check-lib's layout); with
several apps, pass `--app-dir apps/mobile` (without it they stop with exit 2 and name the
candidates). Source folders come from each workspace's layout (`package.json` `workspaces`), so
`check-env` scans `apps/mobile/src` and treats `apps/mobile/src/config` as the reader folder. The
root `.gitignore` and the app's own `.gitignore` both count. `app.config.ts` imports
`./src/config/app-variant.ts` relative to the app folder, as in a single app.
