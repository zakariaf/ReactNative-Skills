# Runtime versions and fingerprints

Why an update can reach only the binaries whose native layer it was made for, how the fingerprint
policy computes that, what it hashes, the two traps measured on SDK 57 and the config that fixes
them. Verified on 2026-10-14 with expo-updates 57.0.24, @expo/fingerprint 0.20.13 (both installed
with Expo SDK 57.0.26) and the docs at docs.expo.dev/eas-update/runtime-versions. Re-verify:
`npm view expo-updates@~57.0.24 version`, then read
`node_modules/expo-updates/utils/build/resolveRuntimeVersionAsync.js` and
`node_modules/@expo/fingerprint/build/sourcer/Expo.js`.

## Contents

1. The two layers and the one compatibility key
2. The policy decision: fingerprint
3. What the fingerprint hashes
4. Each variant has its own runtime version
5. Trap 1: every npm script is hashed
6. Trap 2: a version bump alone strands updates
7. fingerprint.config.js, line by line
8. Determinism: the same commit gives the same runtime
9. SDK moves, new native packages, config plugins
10. Resolving a runtime version by hand
11. Committed native folders (bare)

## 1. The two layers and the one compatibility key

A build has a native layer (the binary: Expo modules, React Native, config plugin output, the
Info.plist and AndroidManifest entries) and an update layer (the JavaScript bundle and its assets).
An update replaces only the update layer. The server sends an update to a phone only when the
platform and the **runtime version** match exactly (EAS Update's selection policy; the Expo Updates
protocol knows only runtime version and platform). A JS bundle that calls a native module the binary
lacks crashes on launch; the runtime version is the one key that prevents it.

## 2. The policy decision: fingerprint

`runtimeVersion` takes a string or `{ policy }` with `nativeVersion`, `sdkVersion`, `appVersion` or
`fingerprint` (`@expo/config-types` 57.0.2). This library uses one default, **`fingerprint`**, set once
at the top level with no `ios.runtimeVersion` / `android.runtimeVersion` override (a platform value
replaces the top-level one).

| Policy | Changes when | Failure mode |
|---|---|---|
| a string | someone edits it | forgotten after adding a native package: the update reaches binaries without the code |
| `appVersion` | `version` changes | same, whenever native code changes without a version bump |
| `nativeVersion` | version or build number | every TestFlight/Play upload is its own runtime; manual numbers |
| `fingerprint` | any native input changes | more store builds; a local install that differs from the build's computes another hash |

Expo's deployment guide still recommends `appVersion` and calls `fingerprint` "experimental and not
yet widely recommended" (checked 2026-10-14). The library chooses `fingerprint` anyway because its
failure is safe and loud: a wrong fingerprint makes an update reach **no** phone, which the update
preflight catches before publishing, while a wrong `appVersion` makes an update reach phones it
breaks. The cost (more store builds) is real and accepted. `bare` projects can use only strings or
`fingerprint` (the policy resolver throws for the others when native folders are committed).

## 3. What the fingerprint hashes

`npx expo-updates runtimeversion:resolve --platform <ios|android>` (what `eas update` itself runs)
calls `@expo/fingerprint` with `ios/**` and `android/**` ignored under Continuous Native Generation,
so a prebuilt and a clean checkout hash the same. With the default options it hashes:

- the whole evaluated Expo config (`expoConfig`): names, ids, scheme, icons paths, `version`,
  `extra`, `updates.url`, `plugins` with their options; only `_internal` and the Google services file
  paths are removed;
- the config plugin sources the config loads (`expoConfigPlugins`: local plugins, `app.plugin.js` of
  every plugin package, files `app.config.ts` imports);
- autolinking (`expoAutolinkingConfig:<platform>`, `rncoreAutolinkingConfig:<platform>`): every native
  module, its version and podspec/gradle inputs;
- `package:react-native` and every `package.json` script (`packageJson:scripts`, minus the
  `android`/`ios` scripts expo prebuild ignores);
- `patches/` and other native sources it finds.

## 4. Each variant has its own runtime version

Measured on a copy of the reference app with the fingerprint policy (iOS, 2026-10-14):

| APP_VARIANT | runtime version |
|---|---|
| development | `98c6697e7357f92898c00dd35c6f4560adfa5533` |
| preview | `ab8cb482649f808ced9307af691ac9cb74d2e464` |
| production | `d72a4079fb8d6b2d012f78c9084b3d38d1872826` |

The config differs per variant (id, name, scheme, icons), so the hash does. Consequence: an update
for the production channel must be built with the production variables. `eas update --environment
production` loads the EAS environment's variables into the config evaluation (EAS CLI 24.12.1
`DynamicProjectConfigContextField`), and resolves the runtime with them; with the preview variables it
would target the preview runtime, which no production binary has. That is why every publish names
`--environment` equal to its channel (`update-environment`).

## 5. Trap 1: every npm script is hashed

With the defaults, changing the `lint` script changed the runtime version of every variant
(measured: `c771bc…` stayed only once the config below filtered scripts). A team that tweaks a script
on the release branch then publishes a fix that reaches nobody. Scripts that npm or EAS Build run on
their own (`preinstall`, `install`, `postinstall`, `preprepare`, `prepare`, `postprepare`,
`eas-build-*`) can patch or generate
native code, so they stay in the hash; everything else leaves it.

## 6. Trap 2: a version bump alone strands updates

`version` is part of the hashed config, so a store release 1.3.0 with the same native layer as 1.2.0
got a new runtime version: 1.2.0 phones stop receiving updates published from 1.3.0's branch even
though nothing native changed. Skipping `ExpoConfigVersions` keeps the runtime across a version-only
release (measured: bumping 1.0.0 to 1.1.0 left `c771bc…` unchanged). Read the binary's own version
from `expo-application` (`nativeApplicationVersion`): `Constants.expoConfig.version` comes from the
running update's manifest and can name a newer version than the binary.

## 7. fingerprint.config.js, line by line

`templates/fingerprint.config.js` (CommonJS, at the app root, next to `app.config.ts`):

- `sourceSkips: ['ExpoConfigVersions', 'ExpoConfigRuntimeVersionIfString',
  'PackageJsonAndroidAndIosScriptsIfNotContainRun']`: a list replaces the default, so the default
  (the last entry) is restated.
- `fileHookTransform`: for the `contents` source `packageJson:scripts`, keeps only lifecycle scripts.
  Contents sources arrive in one chunk (`isEndOfFile` true); the hook handles a string or a Buffer.
- Never `ExpoConfigAll`, `PackageJsonScriptsAll`, `.fingerprintignore` lines for `package.json`, the
  lockfile, `plugins/` or `patches/` (eas-build-and-submit's `fingerprint-config` rule owns those
  lines; this skill's `fingerprint-scripts` rule exercises the hook itself).
- @expo/fingerprint swallows an error thrown while loading the file and uses its defaults (Config.js
  `loadConfigAsync`), so `scripts/ota/fingerprint-config.test.ts` loads it in Jest and the checker
  loads it with `require()`.

## 8. Determinism: the same commit gives the same runtime

The runtime EAS Build computes on its worker must equal the one `eas update` computes on the
publishing machine. It differs when:

- `node_modules` differs from the lockfile (always `npm ci` before publishing; the preflight runs
  after `npm run verify`, which installs nothing, so install first);
- the config reads a value that differs between machines or runs (a date, `os.hostname()`, an
  unset variable with a fallback): expo-prebuild-and-config-plugins' `config-deterministic` rule;
- a variable exists in the shell but not in the EAS environment (eas update sets
  `EXPO_NO_DOTENV=1`, so `.env` files are not read with `--environment`);
- anonymous raw config plugin functions changed (the fingerprint records only the name
  `withAnonymous`): use named local plugin modules.

## 9. SDK moves, new native packages, config plugins

Each of these changes the fingerprint: a new Expo SDK (every module version), `npx expo install` of a
package with native code, a plugin option, a permission string, an icon path, a new locale in the
config. Binaries built before the change never receive updates published after it. The order is
therefore always: store build first (eas-build-and-submit), wait until it is live on its channel,
then updates. expo-sdk-upgrade states the same for SDK moves.

## 10. Resolving a runtime version by hand

```sh
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production \
  npx --no-install expo-updates runtimeversion:resolve --platform ios      # {"runtimeVersion":"…","fingerprintSources":[…],"workflow":"managed"}
eas env:exec production 'EXPO_NO_DOTENV=1 npx --no-install expo-updates runtimeversion:resolve --platform android' --non-interactive
npx --no-install expo-updates fingerprint:generate --platform ios          # the sources, for a diff
```

The second form is what the preflight runs: the EAS environment's variables, exactly as
`eas update` uses them. Comparing two `fingerprintSources` lists shows which input moved.

## 11. Committed native folders (bare)

When `ios/` or `android/` are committed (not ignored by git), the resolver treats the project as
`generic`: the native folders are hashed, policies other than `fingerprint` throw, and the channel
and URL live in `Expo.plist` / `AndroidManifest.xml` (`EXUpdatesURL`, `EXUpdatesRuntimeVersion`,
`EXUpdatesRequestHeaders`; `expo.modules.updates.EXPO_UPDATE_URL`, `EXPO_RUNTIME_VERSION`,
`UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`). This library assumes CNG; the checker reads the app
config only.
