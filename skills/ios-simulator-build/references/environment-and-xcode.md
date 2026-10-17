# Build environment and Xcode selection

What the Mac needs before any iOS build, how the one pinned Xcode is selected for every child process,
which steps only the developer can do, and how to move to the next Xcode.

## Contents

- The toolchain (verified versions)
- Human steps (password, sudo or Apple login)
- Selecting Xcode without xcode-select
- The environment of every tooling process
- Moving to Xcode 27 while on Expo SDK 57
- .gitignore lines for generated folders
- Disk space and cleanup

## The toolchain (verified versions)

Verified on 2026-10-04 on macOS 27.0 (Apple silicon). Re-check with
`xcodebuild -version; xcrun simctl list runtimes; pod --version; node --version; npm --version` when the
date is more than a few weeks old.

| Tool | Version | How it is pinned | Notes |
|---|---|---|---|
| macOS | Tahoe 26.2 or later | none | Xcode 26.6's minimum is macOS 26.2 |
| Xcode | 26.6 (17F113) | `XCODE_VERSION = '26.6'` in `scripts/ios/toolchain.ts` | When several Xcodes coexist, keep the version in the file name (`/Applications/Xcode-26.6.app`); never pick one by its name |
| iOS simulator runtime | iOS 26.5 (23F77) | `IOS_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'` | The iPhone 17 family, iPhone Air, iPhone 16e and the M5 iPads exist on 26.5 |
| Node.js | 26.4.0 (22.18 or newer works) | `.nvmrc` or `.mise.toml` | runs `app.config.ts` and the `.ts` build scripts directly (type stripping) |
| npm | 11.17.0 | bundled with Node 26.4.0 | |
| CocoaPods | 1.15.2 or newer (1.17.0 verified too) | `gem install cocoapods` under a pinned Ruby (3.2.2) | `npx expo prebuild` runs `pod install`; Watchman is not needed |
| Expo SDK | 57 (expo 57.0.26, React Native 0.86.3, React 19.2.3) | the app's `package.json` | Release builds embed the Hermes bytecode bundle; no Metro at run time |

A `.mise.toml` at the repo root pins Node and Ruby for everyone (`mise trust && mise install`):

```toml
[tools]
node = "26.4.0"
ruby = "3.2.2"
```

## Human steps (password, sudo or Apple login)

The agent never types a password, runs `sudo` or signs in to an Apple account. These are the
developer's, once per Mac:

- **Install Xcode 26.6 and accept its licence.** From the Mac App Store or
  developer.apple.com/download/all. Then, in Terminal (admin password):

  ```sh
  # sudo drops DEVELOPER_DIR, and xcode-select may point at another Xcode,
  # so call this Xcode's own xcodebuild by its full path.
  sudo /Applications/Xcode-26.6.app/Contents/Developer/usr/bin/xcodebuild -license accept
  sudo /Applications/Xcode-26.6.app/Contents/Developer/usr/bin/xcodebuild -runFirstLaunch
  ```

  The agent may then run, without sudo:

  ```sh
  DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer xcodebuild -downloadPlatform iOS
  DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer xcrun simctl list runtimes   # expect iOS 26.5
  ```

- **Install a version manager** (mise, nvm) when the Mac has none. Everything after that (Node, Ruby,
  CocoaPods, `npm ci`) the agent does.

When one is missing, stop and ask in one message: what is missing, the exact command or click, and what
the build does meanwhile (nothing).

## Selecting Xcode without xcode-select

`xcode-select --switch` changes the Xcode of every process on the Mac, needs `sudo`, and one wrong
switch silently builds every app with another SDK. So the tooling never calls it. `selectXcode()` in
`toolchain.ts`:

1. lists `/Applications/Xcode*.app`;
2. reads each one's version: `/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" <app>/Contents/Info.plist`;
3. picks the one equal to `XCODE_VERSION` (never "the one named Xcode.app");
4. sets `DEVELOPER_DIR=<app>/Contents/Developer` in the environment of every child process;
5. asserts that `xcodebuild -version` prints `Xcode 26.6` on its first line.

Verified on 2026-10-04 on a Mac with Xcode 26.6 (installed there as `Xcode-26.6.0.app`; selection goes
by version, so any `Xcode*.app` name works) and `/Applications/Xcode.app` (27.0): the function picks 26.6, and `xcodebuild -version` prints
`Xcode 26.6 / Build version 17F113`.

The built app proves which Xcode made it: its `Info.plist` carries `DTXcode = 2660` for Xcode 26.6
(`2700` for 27.0; `xcodeBuildNumber()` computes it). `check-sim-app` reads it (`built-with-xcode`).

## The environment of every tooling process

`toolEnv()` adds three variables on top of the caller's environment:

| Variable | Value | Why |
|---|---|---|
| `DEVELOPER_DIR` | the pinned Xcode's `Contents/Developer` | selects Xcode per process |
| `EXPO_NO_TELEMETRY` | `1` | no Expo CLI telemetry |
| `CI` | `1` | no interactive prompts (a prompt hangs an unattended run) |

The build then adds the two variant variables (`variantEnv`) and passes the one object to every step.
`CI=1` has a side effect worth knowing: `@expo/cli` then keeps Metro's cache warm in the Release
bundling phase, which is why rule 4 (the Metro cache key) is a precondition of this build.

## Moving to Xcode 27 while on Expo SDK 57

Switching Xcode is a deliberate commit, never a side effect:

1. Turn on scene support in the app config (needs `expo` 57.0.23 or newer). Two forms count, and
   `check-sim-setup` accepts either:

   - **The helper (preferred):** `expo-sdk-upgrade` owns `scripts/config/scene-support.ts`, whose
     `addSceneSupport(plugins)` merges `ios.enableSceneSupport: true` into the existing
     `expo-build-properties` entry (or appends one). Copy it from that skill and wrap the plugin list:

     ```ts
     // app.config.ts (excerpt: only when building Expo SDK 57 with Xcode 27)
     import { addSceneSupport } from './scripts/config/scene-support.ts';
     // ...
     plugins: addSceneSupport([
       // ...the app's plugins
     ]),
     ```

   - **The literal entry:** merge it into an existing `expo-build-properties` entry instead of adding a
     second one:

     ```ts
     plugins: [
       // ...the app's other plugins
       ['expo-build-properties', { ios: { enableSceneSupport: true } }],
     ],
     ```

   Without it an app built with the iOS 27 SDK on SDK 57 still uses the application life cycle and
   launches to a black screen on iOS 27. Expo's docs (SDK 57, read 2026-10-04): "Adopt the UIKit scene
   lifecycle in an Expo SDK 57 iOS project, as required by the iOS 27 SDK (Xcode 27)"; SDK 58 includes
   scene support and no longer needs the property. Verified on 2026-09-26 in the source project: with
   the setting, prebuild writes `UIApplicationSceneManifest` with `EXExpoAppSceneDelegate`, and the app
   still builds with Xcode 26.6 and launches on iOS 26.5. The plugin throws on a customised AppDelegate
   or an existing scene manifest.
2. Change `XCODE_VERSION` (and `IOS_RUNTIME` to the runtime that Xcode ships) in one commit.
3. The developer accepts the new licence (human step).
4. Rerun the full suite: the app's gates, a preview and a production simulator build back to back, the
   E2E flows and the screenshot matrix.

`check-sim-setup` fails (`scene-support`) when `XCODE_VERSION` is 27 or newer, the app is on Expo SDK
57 or older, and neither the app config nor a file under `plugins/` sets `enableSceneSupport: true` nor
does the app config call `addSceneSupport(` (when it imports the helper from a file that exists, that file
must set `enableSceneSupport: true`). The check reads text: it does not follow a plugin list built in
another module. Remove the setting or the helper after the SDK 58 upgrade (`expo-sdk-upgrade`).

## .gitignore lines for generated folders

`ios/` and `android/` are regenerated by every `npx expo prebuild --clean` (Continuous Native
Generation) and hand edits there are lost, so they are never committed. `build/` holds DerivedData and
the step logs, `reports/` the screenshots. The canonical `.gitignore` of `typescript-and-lint-rules`
already has all four; `check-sim-setup` (`gitignore`) checks them:

```gitignore
ios/
android/
build/
reports/
```

## Disk space and cleanup

- Keep at least 60 GB free: Xcode is about 15 GB, an iOS runtime about 8 GB, and each app's DerivedData
  plus Pods several GB.
- Delete `build/ios-sim/` when you no longer need the last build.
- `xcrun simctl delete unavailable` removes only simulators whose runtime is gone: safe on a shared Mac.
- Never `xcrun simctl shutdown all`, `erase all` or `delete all`: other sessions use other simulators on
  the same Mac. Delete your own with `deleteOwnSimulator()` (it refuses any name outside
  `<prefix>-*`).
