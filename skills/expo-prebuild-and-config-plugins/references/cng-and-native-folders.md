# Continuous Native Generation and the native folders

What `npx expo prebuild` does on Expo SDK 57, why `ios/` and `android/` are generated and never
committed, how EAS Build and local builds treat the folders, and when an app leaves this model on
purpose. Facts marked "verified" were checked on 2026-10-04 against `expo` 57.0.26 (`@expo/cli`
57.0.27, `@expo/prebuild-config` 57.0.16, `@expo/config-plugins` 57.0.9) in the reference app;
re-verify with `npx expo --version` and the commands quoted next to each fact.

## Contents

- The decision: generated native folders
- What prebuild does (SDK 57)
- Ignoring the folders: .gitignore and .easignore
- EAS Build, expo run and local builds
- Local Expo modules and other nested native folders
- When to leave CNG, and how
- Coming back to CNG
- Speed

## The decision: generated native folders

`ios/` and `android/` are build output of `app.config.ts`, its config plugins and the installed
native packages, the same way `dist/` is build output of the source. They are written by
`npx expo prebuild`, git-ignored, and rebuilt whenever an input changes.

| Option | Why not the default |
|---|---|
| Commit the native folders and edit them | Every hand edit is lost at the next `prebuild --clean`; an SDK upgrade becomes a three-way merge of Xcode and Gradle projects; the config and the projects drift apart silently (expo-doctor reports exactly this, below). |
| Commit them and never edit them | Thousands of generated lines in every review, and nothing stops the first hand edit. |
| Generate them (Continuous Native Generation) | **Default.** One source (`app.config.ts` + plugins); an SDK upgrade is a version bump and a clean prebuild; native changes are reviewed as config and plugin code (and as the native snapshot, `check-native-snapshot.mjs`). |

Consequences the team accepts: every native need is expressed as a config key, a config plugin, or
a local Expo module; nobody opens `ios/` in Xcode to "just fix" a setting; building locally starts
with a clean prebuild.

## What prebuild does (SDK 57)

Verified by reading `@expo/cli` 57.0.27 (`build/src/prebuild/`) and by running
`npx expo prebuild --no-install` in a copy of the reference app:

1. **Cleans by default.** `npx expo prebuild` deletes existing `ios/` and `android/` first
   (`clean: !args['--no-clean']`). `--clean` is still accepted and is the explicit spelling;
   `--no-clean` layers the new config onto the existing folders. Expo's own docs (unversioned page,
   2026-10-04) still describe `--clean` as opt-in; the SDK 57 CLI help prints only `--no-clean`.
   Re-verify: `npx expo prebuild --help`.
2. **Copies the template** `expo-template-bare-minimum` (the `expo` package ships it as
   `template.tgz`), renames the project after the app name (`Tasks (Dev)` becomes the Xcode project
   `TasksDev`), and writes the Podfile and Gradle files.
3. **Updates package.json**: the scripts `"android": "expo start --android"` and
   `"ios": "expo start --ios"` become `expo run:android` / `expo run:ios` (both, whatever
   `--platform` says), and template dependencies the app lacks are added (`--skip-dependency-update`
   keeps listed versions). Seen in the reference app: the first prebuild changed both scripts. Write
   those two scripts deliberately once, so later prebuilds leave `package.json` alone.
4. **Evaluates the config and runs every plugin**: the plugin list, then the plugins Expo applies on
   its own for installed packages (`references/app-config.md`, "Auto-applied plugins"), then the
   built-in iOS and Android plugins (bundle id, name, version, scheme, icons, permissions, locales).
5. **Runs the mods** per platform in a fixed order: dangerous mods first, the Xcode project next on
   iOS, then the others, finalized mods last (`@expo/config-plugins` 57.0.9 `mod-compiler.js`).
6. **Installs** npm packages and CocoaPods unless `--no-install` is passed (`pod install` needs the
   network for trunk pods; the app itself does not).

On a dirty git tree, the destructive path warns; SDK 57 skips the interactive prompt by default
(`EXPO_NO_GIT_STATUS` defaults to true in `@expo/cli` 57.0.27).

## Ignoring the folders: .gitignore and .easignore

The SDK 57 default template ends its `.gitignore` with (verified, `expo-template-default`
57.0.28):

```gitignore
# generated native folders
/ios
/android
```

- **Anchor the two lines.** `/ios` ignores only the folder at the app root. An unanchored `ios/`
  also ignores `modules/<name>/ios/` (a local Expo module's Swift code), `assets/icons/ios/` and any
  other folder of that name: git never sees those files and a fresh clone fails to build.
  `check-native-generation.mjs` fails that case (`native-ignore-scope`) and prints a note for an
  unanchored line even before such a folder exists.
- **Untrack a committed copy**: `git rm -r --cached ios android`, after moving each hand edit into a
  config key or plugin (`native-tracked`).
- **`.easignore` replaces `.gitignore`** for EAS uploads when it exists ("If you create a .easignore
  file, the EAS CLI prioritizes it over the .gitignore file", docs.expo.dev/build-reference/easignore,
  read 2026-10-04). It must repeat every line it still needs, `/ios` and `/android` included;
  otherwise the stale local folders are uploaded and EAS Build skips prebuild (`easignore-native`).

## EAS Build, expo run and local builds

| Command | What it does with the native folders |
|---|---|
| EAS Build | "If your project does not contain android and ios directories, EAS Build will run Prebuild" and "For a project that has android and ios directories, EAS Build will not run Prebuild" (Expo docs, read 2026-10-04). Uploads follow `.gitignore` or `.easignore`, so ignored folders never reach the worker. |
| `npx expo run:ios` / `run:android` | Prebuilds only when the platform folder is missing; when it exists it builds whatever is there (verified, `@expo/cli` 57.0.27 `run/ensureNativeProject.js`). After any config, plugin, dependency or variant change, run `npx expo prebuild --clean --platform <p>` first. |
| A local release build (ios-simulator-build, android-emulator-build, the local release lanes) | Always starts from `npx expo prebuild --clean`, with the build's variant variables exported for the whole run (app-variants-and-environment owns the variant rules). |
| `npx expo prebuild --no-clean` | A quick local look at what a change does. Never in a script or CI (`prebuild-clean`): the result depends on what ran before, and a plugin that is not idempotent duplicates its edit (seen: a `<queries>` entry appeared once per run). |

## Local Expo modules and other nested native folders

Native code the app owns lives in a local Expo module (`modules/<name>/` with `ios/`, `android/`,
`expo-module.config.json`; created with `npx create-expo-module@latest <name> --local`), never in the generated
folders. Its `ios/` and `android/` are source and are committed, which is why the ignore lines must
be anchored. The native-modules-and-new-architecture skill owns writing such a module; Expo's
official `expo-module` skill is the API reference. Code that would otherwise patch AppDelegate or
MainApplication belongs there too (Expo modules have AppDelegate subscribers and Android lifecycle
listeners), so no text mod of generated source is needed.

## When to leave CNG, and how

Stay on CNG for permissions, plist keys, entitlements, Gradle and Pods settings, extra native code
(local modules), app extensions (a config plugin creates the target) and SDK upgrades. Leave it only
when one of these is true, and record why:

| Situation | Why prebuild stops fitting |
|---|---|
| A brownfield app: React Native inside an existing native app | The native project is the product; Expo's official `expo-brownfield` skill covers that integration. |
| A native team edits the Xcode and Gradle projects daily and owns them | Every change would need a plugin first; the team will not work that way. |
| A vendor SDK needs native setup that no plugin automates, and writing one costs more than owning the project | Rare: check the vendor's plugin and the community plugins first. |

Leaving, step by step (stop and ask the developer first: it changes how every later native change
is made):

1. `npx expo prebuild --clean`, build and test both platforms, so the committed starting point is
   correct.
2. Remove `/ios` and `/android` from `.gitignore` (and `.easignore`), commit both folders.
3. Write `contracts/native-generation.json` with `"mode": "committed"`, a `reason` (what no config
   plugin can do) and `decidedOn` (the date). `check-native-generation.mjs` then checks the folders
   exist and are tracked, and fails any script that still runs `expo prebuild` (it would overwrite
   the committed folders; the SDK 57 default deletes them first).
4. From now on `plugins`, `ios.infoPlist`, `android.permissions`, `locales` and the other native keys
   reach the projects only through prebuild, which no longer runs: mirror each change by hand.
   `npx expo-doctor` (1.20.4, verified) fails "Check for app config fields that may not be synced
   in a non-CNG project" and lists them (`orientation, icon, scheme, userInterfaceStyle, ios,
   android, plugins, locales` in the reference app); the checker prints the same as a note.

Mixed mode (one platform committed, the other generated) is not supported by this skill: pick one
model for both folders.

## Coming back to CNG

1. List every difference between the committed folders and a fresh prebuild:
   `npx expo prebuild --clean` into a scratch copy of the repo, then `diff -r` both `ios/` folders
   and both `android/` folders.
2. Express each difference as a config key, an expo-build-properties option, a config plugin
   (`plugins/with-<capability>.ts` with its test) or a local Expo module.
3. Prove it: the generated folders match the committed ones where it matters, both apps build, the
   native snapshot is written (`check-native-snapshot.mjs --write`).
4. Delete the folders from git (`git rm -r --cached ios android`), add `/ios` and `/android` to
   `.gitignore`, set the contract to `"mode": "generated"`.

## Speed

Measured in a copy of the reference app (macOS 27, Node 26.4, 2026-10-04): `npx expo config
--type introspect --json` 1.4 s; `npx expo prebuild --no-install --platform android` 1.7 s;
`--platform ios` 1.0 s. `pod install` and the native builds dominate everything else, which is why
the introspection and the native snapshot are the everyday proof and a full build is the release
proof.
