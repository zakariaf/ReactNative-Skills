# Writing config plugins

How Expo resolves and runs config plugins on SDK 57, and how to write a local one that is typed,
idempotent, testable and survives SDK upgrades. Verified on 2026-10-04 in `@expo/config-plugins`
57.0.9 and `@expo/prebuild-config` 57.0.16 (source read in the reference app) and by experiments with
`npx expo config --type introspect` and `npx expo prebuild --no-install` in a copy of it. Re-verify:
`npm ls @expo/config-plugins` and the experiment steps in `references/testing-and-proof.md`.

## Contents

- What a plugin is
- How Expo resolves a plugin entry
- Local plugins: place, name, export, imports
- Mods: typed, text and dangerous
- Order: plugins run in order, mods run newest first
- Idempotence
- Options
- Run-once plugins and duplicate entries
- Code that would patch AppDelegate or MainApplication
- A plugin's anatomy, line by line

## What a plugin is

A config plugin is a synchronous function `(config, props) => config` (`ConfigPlugin<Props>`). It
may change config values directly, and it queues **mods**: async functions that receive one native
file's parsed contents (`modResults`) during prebuild and return them changed. `withInfoPlist`,
`withAndroidManifest`, `withGradleProperties` and the other `with*` helpers each queue one mod.

Two facts shape every test:

- The helpers **mutate the config object they receive**: `withBaseMod` assigns `config.mods` in
  place (verified: a shared `BASE` object in a test file collected the mods of earlier tests, and a
  later test saw them run). Build a fresh config per test.
- A plugin returns synchronously; only mods are async. A plugin that awaits something at
  config time is a bug.

## How Expo resolves a plugin entry

`plugins` entries are `'name'`, `['name', props]`, or a function (`[fn, props]`). For a string,
`resolvePluginForModule` (verified source) tries, in order:

1. A file reference (starts with `.`, `/` or `~/`, or `pkg/sub/path`): resolved from the project root
   with the extensions `.js .cjs .mjs .ts .cts .mts`.
2. A package: `<package>/app.plugin.{js,cjs,mjs,ts,cts,mts}`.
3. The package's `main` entry, which must export a function.

The errors, as Expo prints them (each one a `check-native-generation.mjs` rule):

| Error | Cause | Rule |
|---|---|---|
| `Failed to resolve plugin for module "x" relative to "<root>". Do you have node modules installed?` (`PLUGIN_NOT_FOUND`) | the package is not installed, or the path is wrong | `plugin-entry` |
| `Package "x" does not contain a valid config plugin. Module must export a function from file: ...` | the package has no `app.plugin.*` and its main exports no function (a library with only native code needs no entry: autolinking links it) | `plugin-entry` |
| `Plugin "./plugins/with-x.ts" must export a function from file: ...` | no default export | `plugin-entry` |

## Local plugins: place, name, export, imports

- **Place and name:** `plugins/with-<capability>.ts`, default export `with<Capability>`
  (naming-conventions owns the names: `with-android-optional-features.ts` exports
  `withAndroidOptionalFeatures`). The test sits beside it: `plugins/with-<capability>.test.ts`.
  Helpers shared by several plugins go in a subfolder (`plugins/lib/`).
- **Listed by path:** `['./plugins/with-android-optional-features.ts', { features: [...] }]`. Never
  imported into `app.config.ts` and applied in code: the plugin list then hides it (`config-mods`,
  `plugin-entry`). Write the extension: it is what a reviewer opens, and Node code always writes it.
- **Default export, tagged for knip:** `/** @public Expo loads it from the path app.config.ts names,
  so it is the default export. */ export default withX;` The ESLint config allows default exports in
  `plugins/**` and `app.config.ts` only.
- **Imports:** Expo's helpers and types from `'expo/config-plugins.js'` on SDK 57 (`'expo/config-plugins'`
  from SDK 58); `ExpoConfig` from `'expo/config'`. Never `@expo/config-plugins` or
  `@expo/config-types` directly: the app does not depend on them, they arrive through `expo`, and a
  second copy can differ from the one Expo runs (`plugin-import`). `mergeContents` is
  `CodeGenerator.mergeContents` from the same import. Relative imports carry `.ts`; Node built-ins
  are allowed (plugins are Node code), network calls are not.

## Mods: typed, text and dangerous

| Kind | Helpers | Introspected | Use |
|---|---|---|---|
| Typed object mods | `withInfoPlist`, `withEntitlementsPlist`, `withExpoPlist`, `withPodfileProperties`, `withAndroidManifest`, `withGradleProperties`, `withStringsXml`, `withAndroidColors`, `withAndroidStyles` | yes | The default. The data is parsed; merge into it. |
| Xcode project | `withXcodeProject` | no | Build settings, files and targets; uses the `xcode` project object. |
| Text mods | `withAppDelegate`, `withPodfile`, `withAppBuildGradle`, `withProjectBuildGradle`, `withSettingsGradle`, `withMainActivity`, `withMainApplication` | no | The file as a string. Edit only through `CodeGenerator.mergeContents` (a tagged block it can find and replace) or behind an `includes` check (`text-mod-idempotent`). |
| Dangerous mods | `withDangerousMod`, `withFinalizedMod` | no | Raw file system access under `modRequest.platformProjectRoot`, for files no mod parses (`res/xml/*.xml`, extra resources). Last resort, with a `// dangerous-mod: <reason>` comment (`dangerous-mod`). |

Dangerous mods run **first** on each platform, finalized mods last, and on iOS the Xcode project
mod runs before the others (`mod-compiler.js` precedences). A file written by a plugin anywhere but
inside a dangerous or typed mod is written at config evaluation, which happens on every `expo start`,
`expo config`, EAS step and knip run (`dangerous-mod`).

## Order: plugins run in order, mods run newest first

Plugins in the list run top to bottom and queue their mods in that order. Each new mod wraps the
previous one and runs its own action **before** calling the older one (`withMod` → `withBaseMod`,
verified source). So for one file, the plugin listed **last** writes first and the plugin listed
**first** writes last and wins a shared key. Verified with two local plugins writing the same
Info.plist key: listed A then B, B's mod ran first and A's value remained.

Practical rules: give each native key one owner; when two plugins must touch the same file, test the
combination with `runMod` (it runs the whole chain in Expo's order).

## Idempotence

`npx expo prebuild --no-clean`, `npx expo run:*` on existing folders and a repeated local build all
apply the mods to files that already carry the last run's changes. Verified: a plugin that pushed a
`<queries>` entry without checking left 1, then 2, then 3 copies after successive `--no-clean` runs;
the template plugin, which replaces its own entries, left 1 every time.

- Object mods: find the entry by its identity (feature name, permission name, scheme) and replace
  it; never append blindly.
- Text mods: `CodeGenerator.mergeContents({ src, newSrc, tag, anchor, offset, comment })` inserts a
  block between generated-code markers and replaces it on the next run; `removeContents` takes it
  out. An anchor regex that stops matching after an SDK template change makes the merge throw:
  that is the signal to update the plugin, not to loosen it. A helper that wraps the merge may live
  in `plugins/lib/` and be imported (named, default or namespace import): the checker follows it.
- Dangerous mods: writing a whole file (`mkdirSync`, then `writeFileSync` or `copyFileSync` of fixed
  contents) is idempotent by construction and needs no guard. Appending (`appendFileSync`, flag
  `'a'`) or reading a file and writing it back needs one on the **contents**:
  `const contents = readFileSync(file, 'utf8'); if (!contents.includes(LINE)) writeFileSync(...)`.
  A check on the path string (`file.includes(...)`) proves nothing.
- Every plugin test applies the transform twice and expects the same result.

## Options

- Expo passes `undefined` when the entry is a bare string: type the plugin
  `ConfigPlugin<Options | undefined>` and throw a message that shows the correct entry.
- Validate options up front with a clear message (`withAndroidOptionalFeatures: "camera" is not an
  Android feature name`); a wrong option should stop `npx expo config`, not produce a broken build.
- Options are JSON: no functions, no `null` (the config serializer turns it into `{}` in what
  `expo config` prints), no secrets (the public config, plugin options included, ships in the app).

## Run-once plugins and duplicate entries

Library plugins wrap themselves in `createRunOncePlugin(plugin, name, version)`: the first
application records the name in `_internal.pluginHistory` and later applications are skipped. Two
entries for one package therefore do not merge: the second entry's options are silently ignored
(`plugin-duplicate`). Verified: with two `expo-image-picker` entries carrying different
`cameraPermission` texts, introspection showed only the first entry's text. This is also how listing an auto-applied package replaces Expo's default run.
Local plugins do not need `createRunOncePlugin`; one entry per plugin is the rule.

## Code that would patch AppDelegate or MainApplication

Native startup code (an SDK's `application(_:didFinishLaunchingWithOptions:)` call, an Android
`Application.onCreate` hook) belongs in a local Expo module (`modules/<name>/`) through an
`ExpoAppDelegateSubscriber` (iOS) or a `ReactActivityLifecycleListener` /
`ApplicationLifecycleListener` (Android), declared in `expo-module.config.json`. Autolinking wires
it in; no text mod touches generated source, and the code is real Swift and Kotlin with a compiler.
native-modules-and-new-architecture owns that work; Expo's official `expo-module` skill is the API
reference.

## A plugin's anatomy, line by line

The template `plugins/with-android-optional-features.ts` is the shape to copy:

1. Line 1 names the path; the header says what it does, why no config key covers it, and how
   `app.config.ts` lists it.
2. `import { withAndroidManifest } from 'expo/config-plugins.js'` and type-only imports of
   `AndroidConfig` and `ConfigPlugin`.
3. `validateFeatures(options)`: throws on missing options, an empty list and malformed names; returns
   the list without duplicates.
4. `addOptionalFeatures(manifest, features)`: a pure function on the parsed manifest; replaces an
   existing declaration of each feature, keeps everything else; idempotent.
5. The plugin: validates, then queues one typed mod that calls the pure function.
6. `/** @public ... */ export default withAndroidOptionalFeatures;`

Its test (`plugins/with-android-optional-features.test.ts`) runs the queued mod through
`runMod` (`test/config-plugins/run-mod.ts`), asserts the result, that iOS gets no mod, that a second
run changes nothing, and that bad options throw.
