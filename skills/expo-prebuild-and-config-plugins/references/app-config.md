# app.config.ts on Expo SDK 57

How Expo finds, loads and serializes the app config, what that means for the file, which native
settings the config already owns (so no plugin is needed), and which plugins Expo applies without
being asked. Verified on 2026-10-04 by reading `@expo/config` 57.0.9, `@expo/require-utils` 57.0.5,
`@expo/config-plugins` 57.0.9, `@expo/prebuild-config` 57.0.16, `@expo/fingerprint` 0.20.13 and
`@expo/config-types` 57.0.2 in the reference app, and by running `npx expo config` there.
Re-verify: `npm ls @expo/config @expo/config-plugins @expo/prebuild-config` and the experiments
quoted below.

## Contents

- Finding the config
- Loading it: TypeScript, imports and the Node world
- The config context and the returned object
- Serialization: null, functions, plugins
- Determinism: the fingerprint hashes the config
- What ships inside the app
- Looking at the result: expo config types
- Built-in keys before plugins
- Auto-applied plugins
- The variant: one config, three evaluations

## Finding the config

`@expo/config` looks for `./app.config` with the extensions `.ts, .mts, .cts, .mjs, .cjs, .js`, in
that order, and takes the first one it finds; any other `app.config.*` is silently ignored. A static
`app.config.json` or `app.json` is read too and handed to the dynamic config as `config`. So:

- `app.config.ts` is the only config file (`single-config`). An `app.json` beside it means values
  live in two places and the dynamic config may or may not spread them in.
- An old `app.config.js` next to a new `app.config.ts` is dead code that looks alive.
- Move every value of an `app.json` into `app.config.ts` and delete `app.json`; app-variants-and-
  environment's workflow does that merge and diffs the production config before and after.

## Loading it: TypeScript, imports and the Node world

Expo loads `app.config.ts` with `@expo/require-utils`: it transpiles the file with the app's own
`typescript` package (`transpileModule`, CommonJS output) and evaluates it; without `typescript` it
falls back to Node's type stripping. Every `.ts` file the config imports is loaded by Node itself
(Node 22.18+ strips types by default), as an ES module. Consequences, all verified:

- **Relative imports carry the extension** (`./src/config/app-variant.ts`). Node does not probe
  extensions for ES modules, and it ignores tsconfig `paths`: `@/config/...` fails with "Cannot find
  package '@/config'". The ESLint config enforces the extension for Node code
  (typescript-and-lint-rules); architecture-and-boundaries keeps app code from importing Node code.
- **Only erasable TypeScript** in files Node loads: no `enum`, no `namespace` with values, no
  parameter properties (`erasableSyntaxOnly` in the strict tsconfig catches them).
- **No React Native, Expo module or JSX import** anywhere in the config's import graph: Node cannot
  load them and `npx expo config` fails before prebuild starts.
- **Expo's helpers from `expo/config-plugins.js` on SDK 57.** The `expo` package has no `exports` map
  on SDK 57, so a Node ES module importing `'expo/config-plugins'` fails: verified, a helper module
  imported by a plugin stopped `npx expo config` with `ERR_MODULE_NOT_FOUND ... Did you mean to import
  "expo/config-plugins.js"?`, and so did a plugin file imported by `app.config.ts`. The `.js` spelling
  works in every loader (Expo's, Node's, Jest's, tsc's). SDK 58's `expo` has an exports map
  (`"./*": "./*.js"`, read from the npm registry for `expo@58.0.0`), so the spelling flips to
  `'expo/config-plugins'` at the SDK move (expo-sdk-upgrade owns the move; `plugin-import` follows
  the installed SDK).
- Expo's docs suggest `import 'tsx/cjs'` at the top of `app.config.ts` for TypeScript plugins. SDK 57
  does not need it: the loader above handled `.ts` plugins by path in the reference app.

## The config context and the returned object

The default export is either an object or a function of `ConfigContext`:
`{ projectRoot, staticConfigPath, packageJsonPath, config }`. `config` is the static config with
defaults filled in (name and version from package.json, `_internal` with the project root).

- **Return the object synchronously.** A Promise is refused: `Config file <root>/app.config.ts cannot
  return a Promise.` (verified). Read files with `readFileSync`; never fetch in the config.
- **Spread the incoming `config`** (`return { ...config, name, ... }`). It carries `_internal`; a
  config built without it and then handed to a string plugin inside the file fails with "Unexpected:
  Config `_internal.projectRoot` isn't defined by expo-cli, this is a bug." (verified).
- **Pass `process.env` in, keep the logic pure.** `resolveAppVariant(process.env)` in
  `src/config/app-variant.ts` (app-variants-and-environment) is called with the whole environment and
  tested with plain objects.
- **Apply no plugin in the file.** Calling `withInfoPlist(...)`, `withPlugins(...)` or an imported
  local plugin on the returned object works, but the change disappears from `npx expo config`'s
  plugin list (verified: a directly applied plugin was missing from `plugins` in the public config
  while its mod still ran). List plugins in `plugins` instead (`config-mods`).

## Serialization: null, functions, plugins

After the function returns, `@expo/config` serializes every key except `mods` and `plugins`
(`Serialize.js`):

- **`null` becomes `{}`** at any depth, arrays included. Verified: `extra: { storeId: null, list:
  [1, null] }` came out of `npx expo config --type public` as `{"storeId":{},"list":[1,{}]}`. The
  same object is embedded in the app: `Constants.expoConfig.extra.storeId` holds `{}`, so a valibot
  schema expecting `string | null` throws at launch (the mechanism follows from the experiment
  above). Leave keys out instead (`...(storeId ? { storeId } : {})`) (`config-null`).
- **A function value is called** (with no arguments) and replaced by its result; keep functions out
  of config values.
- **Plugin entries are kept as written** for Expo, and printed by name: an imported function shows as
  `withMarkerA` in the public config, a path as `./plugins/with-x.ts`. A path is what a reviewer can
  open, and it is the form this skill requires (`plugin-entry`).

## Determinism: the fingerprint hashes the config

`@expo/fingerprint` (the runtime version policy `fingerprint` used for OTA updates) hashes the
serialized config and every module loaded while loading it (`expoConfigPlugins` sources: local
plugins and the files `app.config.ts` imports). Anything that changes between two evaluations with the
same environment (`Date.now()`, `new Date()`, `Math.random()`, the machine's paths or user name)
changes the fingerprint on every run, so an update never matches a build. The checker evaluates the
config twice and compares (`config-deterministic`); ota-updates owns runtime versions.

## What ships inside the app

The public config (`Constants.expoConfig`) is embedded in every build: everything except `_internal`,
`hooks`, `ios.config`, `android.config` and the update code-signing keys. Plugin options are part of
it. No secret goes into the config or into plugin options (app-variants-and-environment's rule).

## Looking at the result: expo config types

| Command | Shows |
|---|---|
| `npx expo config --type public --json` | What the app embeds (the variant variables must be set as the build sets them) |
| `npx expo config --type prebuild --json` | The config after static plugins, as prebuild sees it |
| `npx expo config --type introspect --json` | `_internal.modResults`: the native files the mods would write, without writing them |

Introspection runs only the mods with an introspection provider (verified, `withIosBaseMods` /
`withAndroidBaseMods`): iOS `infoPlist`, `entitlements`, `expoPlist`, `podfileProperties` (and the
splash storyboard); Android `manifest`, `gradleProperties`, `strings`, `colors`, `colorsNight`,
`styles`. Dangerous and finalized mods, the Xcode project, the Podfile, AppDelegate and every Gradle
or Java/Kotlin source mod are skipped, so their effect is visible only in a real prebuild
(`references/testing-and-proof.md`).

## Built-in keys before plugins

A config key is validated, documented, introspectable and maintained across SDK upgrades by Expo; a
plugin is code the app maintains. Check this table (and `expo-build-properties`) before writing one
(`builtin-first` fails the common cases):

| Need | Built-in home (SDK 57) |
|---|---|
| Any Info.plist key, localized purpose strings | `ios.infoPlist`; per language `locales.<lang>.ios` (app name, purpose strings) |
| Entitlements, associated domains | `ios.entitlements`, `ios.associatedDomains` (or the module's own plugin options) |
| Privacy manifest | `ios.privacyManifests` (privacy-and-store-declarations owns its content) |
| iOS deployment target | `ios.deploymentTarget` (built in since SDK 56; expo-build-properties' copy is deprecated) |
| URL schemes | `scheme`, `ios.scheme`, `android.intentFilters` |
| Android permissions | `android.permissions`; remove one a library adds with `android.blockedPermissions` |
| Android backup, keyboard mode, predictive back | `android.allowBackup`, `android.softwareKeyboardLayoutMode`, `android.predictiveBackGestureEnabled` |
| Firebase files | `ios.googleServicesFile`, `android.googleServicesFile` (never `cp` into `android/app/`) |
| Android SDK versions, Kotlin, ABIs, minify, cleartext, Maven repos, `<queries>` | `expo-build-properties`: `android.minSdkVersion`, `compileSdkVersion`, `targetSdkVersion`, `buildToolsVersion`, `kotlinVersion`, `buildArchs`, `enableMinifyInReleaseBuilds`, `usesCleartextTraffic`, `extraMavenRepos`, `manifestQueries` |
| use_frameworks, extra pods, ccache, scene support | `expo-build-properties`: `ios.useFrameworks`, `ios.extraPods`, `ios.ccacheEnabled`, `ios.enableSceneSupport` |

Worked example, no plugin needed: the Tasks app checks `Linking.canOpenURL('mailto:...')` before it
offers "Email this list". iOS answers only for schemes in `LSApplicationQueriesSchemes` (React Native
0.86 rejects the call with "Unable to open URL ... Add mailto to LSApplicationQueriesSchemes in your
Info.plist." otherwise, `RCTLinkingManager.mm`), and Android 11+ needs a `<queries>` intent:

```ts
ios: { infoPlist: { LSApplicationQueriesSchemes: ['mailto'] } },
plugins: [
  ['expo-build-properties', {
    android: { manifestQueries: { intent: [{ action: 'android.intent.action.VIEW', data: { scheme: 'mailto' } }] } },
  }],
],
```

A plugin is right when no key covers the need: `<uses-feature>` (the template
`with-android-optional-features.ts`), Android `<meta-data>` a vendor SDK reads, arbitrary
`gradle.properties` entries, an Xcode build setting, a file in `res/xml/`.

## Auto-applied plugins

Prebuild applies some packages' config plugins **with default options** whenever the package is
installed, even if `plugins` does not list it (verified: `@expo/prebuild-config` 57.0.16,
`withVersionedExpoSDKPlugins` and `withLegacyExpoPlugins`; the list is in
`assets/auto-plugins.json`). Listing the package with options replaces the default application
(`createRunOncePlugin` skips the second run), but it changes only what the options control:
`expo-file-system` adds its three Android permissions whatever its options, and only
`android.blockedPermissions` removes them (`blockedPermissions: ['READ_EXTERNAL_STORAGE',
'WRITE_EXTERNAL_STORAGE']` for an app that keeps files in its own sandbox). A short name gets the
`android.permission.` prefix, but nothing is upper-cased and the manifest match is exact, so
`'android.permission.write_external_storage'` adds a second, lower-case removal entry and keeps the
real permission (@expo/config-plugins 57, verified by introspection). In the reference app, where
none of the first five was listed, introspection showed:

| Installed package | Added by its default plugin run |
|---|---|
| `expo-notifications` | `aps-environment: development` entitlement (every signing profile must then include push) |
| `expo-apple-authentication` | `com.apple.developer.applesignin` entitlement |
| `expo-image-picker` | English purpose strings for camera, microphone and photos ("Allow $(PRODUCT_NAME) to access your camera"), Android `RECORD_AUDIO` |
| `expo-file-system` | Android `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `INTERNET` |
| `expo-task-manager` | `UIBackgroundModes: [fetch]` |
| `expo-background-task` | **nothing: not auto-applied in SDK 57.** It is missing from @expo/prebuild-config's lists and its `expo-module.config.json` declares no plugin (introspected 2026-10-14), although Expo's page says prebuild applies it. List `'expo-background-task'` yourself, after `'expo-task-manager'`: it adds `UIBackgroundModes: processing` and `BGTaskSchedulerPermittedIdentifiers`, without which registration rejects on an iOS device (background-tasks' `background-plugin` and `background-plist` rules enforce it) |
| `expo-dev-client` (its dev-launcher part, listed or not) | a local-network purpose string and the `_expo._tcp` Bonjour service in every variant's Info.plist; an Xcode build phase it adds strips both from non-Debug builds (`expo-dev-launcher` 57 plugin source) |

That is why every installed auto-applied package is listed explicitly (`auto-plugin-listed`), with
the options the app means: `['expo-image-picker', { photosPermission: '...', cameraPermission: '...',
microphonePermission: false }]` (the app never records; `false` also blocks `RECORD_AUDIO`), or bare
(`'expo-task-manager'`) to accept the defaults on purpose. Packages whose plugin only mirrors a
top-level key (`expo-system-ui`, `expo-updates`, `expo-navigation-bar`) are exempt. The purpose-string
wording belongs to permissions-and-system-prompts; the store declarations to privacy-and-store-
declarations.

## The variant: one config, three evaluations

app-variants-and-environment owns `APP_VARIANT` (ids, names, icons, schemes per variant). For this
skill it means the plugin list is evaluated per variant: `check-native-generation.mjs` evaluates
development, preview and production when the config reads `APP_VARIANT`, and every rule holds in each
(a plugin listed only for development leaves production on Expo's defaults). Variant-dependent plugin
options are computed in the config (`['expo-dev-client', { addGeneratedScheme: variant ===
'development' }]`), never by editing generated files afterwards.
