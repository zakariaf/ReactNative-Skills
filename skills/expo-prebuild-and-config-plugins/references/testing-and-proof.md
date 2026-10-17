# Testing plugins and proving native changes

Four levels of proof, from cheapest to most complete, and when each is required. Commands verified on
2026-10-04 in a copy of the reference app (Expo SDK 57, Node 26.4, Jest 29.7 with jest-expo 57).

## Contents

- The levels
- Level 1: unit tests of the transform
- Level 2: wiring tests through Expo's mods (runMod)
- Jest must reach plugins/
- Level 3: introspection and the native snapshot
- Level 4: a real prebuild, and a build
- What each proof cannot see
- CI

## The levels

| Level | Proves | Cost | Required when |
|---|---|---|---|
| 1. Unit test of the pure transform | the logic: merge, replace, validation, idempotence | milliseconds, Jest | every local plugin |
| 2. Wiring test through `runMod` | the plugin queues the right mod and Expo's chain runs it | milliseconds, Jest | every local plugin |
| 3. Introspection + native snapshot | the whole config (every plugin, auto-applied ones included, in order) produces the intended native config | about 1.5 s | every change to `app.config.ts`, a plugin, or a native package |
| 4. `npx expo prebuild --no-install` and a build | the files on disk (text mods, dangerous mods, Xcode project) and the merged result | seconds, then minutes | text or dangerous mods; before a release |

## Level 1: unit tests of the transform

Write the plugin as a pure function on the parsed file plus a thin `with*` wrapper (the template's
`addOptionalFeatures`). Test it with plain objects shaped like what prebuild hands over:

- the intended entries appear (and nothing else changes: compare an untouched part with
  `toStrictEqual`);
- existing entries are kept, and an existing entry for the same identity is replaced;
- applying it twice equals applying it once (idempotence);
- invalid options throw with the message the plugin promises, and so does a bare entry
  (`withX(config, undefined)`).

## Level 2: wiring tests through Expo's mods (runMod)

`test/config-plugins/run-mod.ts` (a template) runs the mods queued for one file the way prebuild does
(`config.mods[platform][mod]` with a `modRequest` like `mod-compiler.js` builds), on contents the
test provides:

```ts
const config = withAndroidOptionalFeatures(baseConfig(), { features: [CAMERA] });
const manifest = await runMod(config, { platform: 'android', mod: 'manifest', modResults: manifestWith() });
await expect(runMod(config, { platform: 'ios', mod: 'infoPlist', modResults: {} })).rejects.toThrow('no ios.infoPlist mod is queued');
```

- Build a fresh config per test (`function baseConfig(): ExpoConfig { ... }`): the helpers assign
  `config.mods` on the object they receive, so a shared constant leaks mods into later tests
  (verified; `run-mod.test.ts` pins that behaviour so an SDK change is noticed).
- To test two plugins together, apply both to one config in list order and run the file's mod once:
  the plugin applied first writes last (verified in `run-mod.test.ts`).
- Mod names: iOS `infoPlist`, `entitlements`, `expoPlist`, `podfileProperties`, `xcodeproj`,
  `podfile`, `appDelegate`, `dangerous`; Android `manifest`, `gradleProperties`, `strings`, `colors`,
  `styles`, `appBuildGradle`, `projectBuildGradle`, `settingsGradle`, `mainActivity`,
  `mainApplication`, `dangerous`. A text mod's `modResults` is `{ contents, language, path }`; give the
  test the SDK template's real file contents (copied once from a prebuild into a fixture) so an anchor
  regex is tested against what prebuild really produces.

## Jest must reach plugins/

The canonical `jest.config.js` (unit-and-component-tests) selects tests under `src/`, `scripts/` and
`test/` only (`TEST_ROOTS`, checked 2026-10-04). A `plugins/with-x.test.ts` then never runs, and
`--passWithNoTests` hides it. The fix is one entry, `'<rootDir>/plugins/**/'`, in `TEST_ROOTS`.
`check-native-generation.mjs` loads the Jest config and fails a plugin test no project reaches
(`plugin-test`); `npx jest --listTests | grep plugins/` shows it by hand. (Do not try to filter with
`npx jest plugins`: the pattern matches any path that contains "plugins", including the repo's own
folder name.)

## Level 3: introspection and the native snapshot

```sh
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo config --type introspect --json > reports/introspect.json
```

`_internal.modResults` holds Info.plist, entitlements, Expo.plist, Podfile properties, the
AndroidManifest, gradle.properties, strings, colors and styles as prebuild would write them, with
every plugin applied, auto-applied ones included (`references/app-config.md`). It runs no dangerous,
finalized, Xcode-project or text mod.

`check-native-snapshot.mjs` turns this into a reviewable file:

1. `node ${CLAUDE_SKILL_DIR}/scripts/check-native-snapshot.mjs . --write` writes `contracts/native-config.json`
   (production variant by default when the config reads `APP_VARIANT`): Info.plist without the two
   version keys, entitlements, Expo.plist, Podfile properties; Android permissions, features,
   queries, application attributes, components with intent filters, meta-data, gradle.properties,
   strings. Commit it.
2. Every later run compares and prints one `native-drift` line per difference ("android.permissions:
   added android.permission.ACCESS_FINE_LOCATION"). An intended change is accepted by rerunning with
   `--write` and committing the snapshot with the change; an unintended one is traced to its plugin
   or package. Adding a plugin changes keys its own line never names: `['expo-secure-store', {
   faceIDPermission: false }]` (auth-and-secure-storage) also sets `android:dataExtractionRules` and
   `android:fullBackupContent` on `android.application` (it keeps the secure store out of Android
   backups), so the first run after it reports those two as `native-drift`. Read them, then `--write`.
3. The first snapshot of an existing app is an audit: read every key. In the reference app it showed
   push and Sign in with Apple entitlements and generic camera and microphone strings that no line of
   `app.config.ts` asked for (all from auto-applied plugins of installed packages).
4. Two keys in a snapshot are not what a release build ships (read in source on 2026-10-16:
   `withIosBaseMods.js` of @expo/config-plugins 57, expo-template-bare-minimum 57.0.30): without an `ios/` folder,
   introspection starts from `withIosBaseMods`' placeholder Info.plist, whose `NSAppTransportSecurity`
   is `NSAllowsArbitraryLoads: true` plus a `localhost` exception, while prebuild's real template
   writes `NSAllowsArbitraryLoads: false` and `NSAllowsLocalNetworking: true`; and expo-dev-client's
   local-network purpose string and `_expo._tcp` Bonjour entry appear in every variant because the
   Xcode build phase that strips them from non-Debug builds never runs during introspection. Neither
   is an ATS exception or a production string; a reviewer (and privacy-and-store-declarations) reads
   them with this in mind, and a real `npx expo prebuild` in a scratch copy settles any doubt.

## Level 4: a real prebuild, and a build

Generate into the app's (git-ignored) folders without installing pods or packages:

```sh
npx expo prebuild --clean --no-install --platform android
grep -n 'uses-feature' android/app/src/main/AndroidManifest.xml
npx expo prebuild --clean --no-install --platform ios
plutil -extract LSApplicationQueriesSchemes json -o - ios/*/Info.plist
npx expo prebuild --no-clean --no-install --platform android   # once more onto the same folders:
grep -c 'android.hardware.camera"' android/app/src/main/AndroidManifest.xml   # still 1: idempotent
git status --short package.json   # prebuild may have rewritten the ios/android scripts
```

Verified on the template plugin: the manifest held each `<uses-feature>` once after a clean run and
after a `--no-clean` run. Delete nothing by hand afterwards; the folders are ignored and the next
clean prebuild replaces them.

A build proves what prebuild cannot: library manifests merged by Gradle (permissions a library's own
`AndroidManifest.xml` adds), CocoaPods and the compiled app. ios-simulator-build and
android-emulator-build own those runs on named devices; the release skills own the store artifacts.

## What each proof cannot see

| Proof | Blind spot |
|---|---|
| Unit and wiring tests | Expo's template contents (unless the test copies them), other plugins' interaction (unless combined) |
| Introspection / snapshot | text mods, dangerous mods, the Xcode project, Podfile, Gradle scripts, library manifests merged at build time |
| `prebuild --no-install` | CocoaPods resolution, compilation, library manifests |
| A build | nothing above, but it costs minutes: keep it for release evidence |

## CI

- `node ${CLAUDE_SKILL_DIR}/scripts/check-native-generation.mjs .` and `node ${CLAUDE_SKILL_DIR}/scripts/check-native-snapshot.mjs .`
  after `npm ci`, in the job that runs the other checkers (ci-pipeline-and-gates owns the pipeline,
  quality-gates the local `verify`).
- The snapshot check needs only `npm ci` (no Xcode, no Android SDK): it runs on any Linux runner.
- A clean prebuild per platform belongs to the build jobs, never `--no-clean`.
