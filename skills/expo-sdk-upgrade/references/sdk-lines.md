# SDK lines: the data the checkers judge against

The checkers hold no version in code. What each Expo SDK expects lives in data: this skill's
`assets/sdk-lines.json` (one entry per SDK), the module maps, `assets/store-requirements.json`, and
optionally the app's own `contracts/expo-sdk-lines.json`. Read this before writing or refreshing any
of them, and when a checker reports `sdk-unknown` or `sdk-lines-contract`.

## Contents

- Where the data comes from
- The keys of an SDK entry
- The app's own entries: contracts/expo-sdk-lines.json
- Repo settings the checkers read
- Refreshing the data when a new SDK ships
- Store requirements

## Where the data comes from

| File | Holds | Read by |
|---|---|---|
| `assets/sdk-lines.json` | one entry per SDK (57 stable, 58 a pre-release snapshot), shape in `assets/sdk-lines.schema.json` | both checkers |
| `assets/expo-sdk-57-module-map.json` | expo 57.0.27's `bundledNativeModules.json` (the library's shared copy, also in dependency-management; never edit it here) | alignment, when `node_modules` is absent |
| `assets/expo-sdk-58-next-module-map.json` | expo 58.0.3's map (npm `next`, read 2026-10-04) | alignment, when `node_modules` is absent |
| `assets/store-requirements.json` | App Store minimum Xcode, Google Play minimum targetSdk, with dates and sources | trigger |
| `contracts/expo-sdk-lines.json` (the app's, optional) | entries that replace this skill's entry for the same SDK | both checkers |

The installed `node_modules/expo/bundledNativeModules.json` always wins over a copy when it is on the
app's SDK: it is exactly what `npx expo install` applies.

## The keys of an SDK entry

| Key | Meaning | Rule that reads it |
|---|---|---|
| `status` | stable or pre-release, the version read and the date | (shown to readers) |
| `expo` | the expo version the entry was read from | (shown) |
| `reactNative` | React Native version or line (`"0.88"`) | messages |
| `react`, `typesReact`, `testRenderer` | the React line and the matching `@types/react` and `test-renderer` lines | `core-pins`, `react-line` |
| `typescript`, `jest`, `typesJest` | the TypeScript and Jest lines the SDK keeps or needs (Jest: what the SDK's jest-expo peers on), `@types/jest` exact | `held-back` (ahead), `sdk-tooling` (behind) |
| `gestureHandlerMajor` | Gesture Handler major in the module map | `gesture-api` |
| `skiaPostinstallUntil` | first Skia version without an install script | `skia-approval` |
| `configPluginsImport` | `expo/config-plugins.js` (no exports map) or `expo/config-plugins` | `config-plugin-import` |
| `jestConfigMustInclude` | `{ text, why, fix }` lines the root Jest config must contain | `jest-config` |
| `xcodeMin` | lowest Xcode that builds the SDK | `xcode` |
| `xcodeMaxWithoutSceneSupport` | highest Xcode major that builds it without `ios.enableSceneSupport` (null: the SDK handles scenes) | `scene-support` |
| `sceneSupportMinExpo` | first expo that accepts `ios.enableSceneSupport` (null: the option is a no-op, remove it) | `scene-support` |
| `android` | `compileSdk`, `targetSdk`, `minSdk` (required), `buildTools`, `agp`, `kotlin`, `ndk`, `jdk` | `android-sdk`, `store-deadline` |
| `eas` | `iosImage`, `androidImage`: the exact images the `sdk-<n>` alias named on the verified date | `eas-image` messages |
| `removedApis` | `{ id, rule (removed-rn-api or removed-test-api), scope (app or test), from, pattern, fix }` | `removed-rn-api`, `removed-test-api` |
| `removedAppConfigKeys` | `{ key, pattern, since, fix }`: app config keys the schema dropped | `removed-config` |

`pattern` values are JavaScript regular expression sources, matched against source with comments
masked (strings kept). A readiness scan (`--target-sdk <n>`) applies the next SDK's `removedApis`,
`removedAppConfigKeys`, `configPluginsImport`, `jestConfigMustInclude`, `gestureHandlerMajor`,
`xcodeMin` and `android` values to today's code.

## The app's own entries: contracts/expo-sdk-lines.json

An installed skill is read-only (a plugin cache, `.agents/skills/`), and an app may move before this
skill is refreshed for a new SDK. Then the app writes the entry itself:

```json
{
  "$comment": "Expo SDK 59 entry until the expo-sdk-upgrade skill describes it; values read 2027-02-20 from expo 59.0.4.",
  "sdks": {
    "59": { "status": "...", "expo": "...", "reactNative": "...", "...": "every key of the table above" }
  }
}
```

- Each valid entry **replaces** this skill's entry for that SDK, and both checkers print
  `sdk-lines SDK <n> from contracts/expo-sdk-lines.json (replaces this skill's entry)` so nobody
  forgets it is there. `examples/expo-sdk-lines.json` is a complete entry to start from.
- An invalid entry is ignored and fails `sdk-lines-contract` with every missing or wrong key; invalid
  JSON fails too.
- Write it in the move commit, from the stable release (the "Confirm at move time" commands of the
  change list), and note in `$comment` where each value came from.
- Delete it once an updated skill describes the SDK, so the shared data wins again.
- Without a module map for the new SDK in `node_modules` or in this skill, the alignment check notes
  `module map: none` and skips `module-map` and `duplicate-native`: run it after `npm ci`.

## Repo settings the checkers read

`rn-skills.config.json` at the repo root (optional; the layout keys of every skill live there too):

| Key | Meaning | Default |
|---|---|---|
| `expoSdkLines` | repo-relative path of the app's SDK lines file | `<contractsDir>/expo-sdk-lines.json` (`contracts/expo-sdk-lines.json`) |
| `xcodeVersionFile` | a file holding the Xcode version (a bare version or an `XCODE_VERSION = '…'` constant) | `.xcode-version`, then any toolchain module exporting `XCODE_VERSION` |
| `contractsDir`, `srcDir`, `testDir`, `mocksDir`, `scriptsDir` | the layout keys the scans use | the canonical single-app layout |

Options override both: `--sdk-lines <file>`, `--xcode <version>`, `--jest-config <file>`.

## Refreshing the data when a new SDK ships

For the maintainers of this skill (and, through `contracts/expo-sdk-lines.json`, for an app that
moves first):

1. **When the next SDK's first preview is out:** add a pre-release entry from its
   `bundledNativeModules.json`, the versions API, React Native's `gradle/libs.versions.toml`, the
   jest-expo peers and the versioned docs; mark `status` as pre-release with the version and date;
   save its map as `expo-sdk-<n>-next-module-map.json` (first key a `$comment`).
2. **When the SDK is stable and the trigger holds:** replace the entry with the stable values, swap
   the next map for `expo-sdk-<n>-module-map.json` (the library keeps that copy shared with
   dependency-management), and rewrite `references/sdk-<n>-changes.md` from the stable release notes.
3. Refresh `store-requirements.json` from Apple's and Google's requirement pages, and the EAS image
   table in references/toolchain.md from the EAS infrastructure page.
4. Run the self-test: the fixture bases name versions, so a refreshed line shows up as failing cases
   to update, never as silent drift.

## Store requirements

`assets/store-requirements.json`: `appStore[]` entries `{ from, xcodeMin, rule, source }` and `play[]`
entries `{ from, targetSdkMin, extensionUntil?, rule, source }`. `check-sdk-trigger.mjs` compares
every recorded Xcode with each App Store entry and the app's Android targetSdk (a `targetSdkVersion`
pin, else the SDK line's value) with each Play entry: in effect and unmet fails `store-deadline`,
later and unmet prints a `notice` line. Add entries as the stores announce them; never delete one in
effect.
