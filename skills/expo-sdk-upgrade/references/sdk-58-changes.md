# SDK 57 to 58: every change and its fix

<!-- stack-pin-ignore-file: this reference describes the next SDK and its versions on purpose -->

What moves and what breaks when an app goes from Expo SDK 57 to 58, with the exact fix for each.
SDK 58 is still a pre-release (npm `next` = 58.0.3 on 2026-10-04): re-read every value from the
stable release at move time ("Confirm at move time" below). Read this at runbook step 3 and again for
each failing gate during the move.

## Contents

- How each fact was established
- Package moves (the module map)
- Root dev tools: one install command
- One version of every native module: overrides
- Config plugins: expo now has an exports map
- Jest: the Reanimated resolver and the asset-registry mapping
- Jest 30
- Gesture Handler 3: hooks replace the builder
- Reanimated 4.7 and Worklets 0.13 at runtime
- Skia 2.13
- React 19.3, test-renderer 1.3, @types/react 19.3
- React Native 0.88: removed and changed APIs
- Expo Router 58: usePreventRemove
- Android: compileSdk 37 and AGP 9
- iOS: scene support, Xcode, EAS images
- Confirm at move time

## How each fact was established

- **Read on 2026-10-04 from the published packages and docs:** the 58.0.3 module map
  (`assets/expo-sdk-58-next-module-map.json`), expo's `exports` map, jest-expo 58.0.7's peers and
  dependencies, the removed APIs in React Native 0.88.0-rc.3's source, its `gradle/libs.versions.toml`,
  Jest 30.5.2's `expect` and `jest-runtime` builds, the v58 docs of expo-build-properties and the EAS
  build-image list.
- **Rehearsed on 2026-09-28** ("the rehearsal" below): a copy of an Expo SDK 57 app was moved to
  58.0.0-preview.7, with the 7-day age policy relaxed in that copy only. It showed: the `ERESOLVE` of
  a lone jest-expo install, the duplicate-module fix with overrides, the config-plugin import
  failure, the Jest resolver and asset-registry fixes, a Gesture Handler 3 hook module type-checked
  against 3.2.1, scene support on SDK 57. Green there: `npx expo install --fix`, typecheck, lint,
  Jest with coverage, knip, `npx expo install --check`, `npx expo-doctor`, `npx expo config`,
  `npx expo export --platform ios`.
- **Not rehearsed** (part of the trigger's third condition, done on the branch): Jest 30 itself (it
  arrived in jest-expo 58.0.7 after the rehearsal), `npx expo prebuild --clean`, Release builds on
  iOS and Android, E2E flows, visual baselines, AGP 9 builds.

## Package moves (the module map)

| Package | SDK 57 | SDK 58 (58.0.3, next) |
|---|---|---|
| `react-native` | 0.86.3 | 0.88.0-rc.3 |
| `react` / `react-dom` | 19.2.3 | 19.3.0 |
| `react-native-reanimated` | 4.5.1 | 4.7.0 |
| `react-native-worklets` | 0.10.1 | 0.13.0 |
| `react-native-gesture-handler` | ~2.32.0 | ~3.2.1 |
| `@shopify/react-native-skia` | 2.6.2 | 2.13.1 |
| `react-native-screens` | ~4.26.0 | ~4.28.0 |
| `react-native-safe-area-context` | ~5.7.0 | ~5.9.1 |
| `@sentry/react-native` | ~7.11.0 | ~8.28.0 |
| `@shopify/flash-list` | 2.0.2 | 2.3.2 |
| `expo-*` modules | ~57.0.x | ~58.0.x (`expo-router` ~58.0.13, `expo-sqlite` ~58.0.9, `expo-notifications` ~58.1.0) |
| `jest-expo` / `eslint-config-expo` | ~57.0.5 / ~57.0.2 | ~58.0.7 / ~58.0.4 |

`npx expo install expo@<version>` writes the specifier as given, so move with
`npx expo install expo@~58.0.N` to keep the tilde form, then `npx expo install --fix`. Packages
outside Expo's map (React Navigation, the ads and purchase libraries, Zustand, TanStack Query,
valibot, react-intl) do not move with the SDK: check each one's peer ranges against React 19.3 and
React Native 0.88 with `npm view <pkg>@<version> peerDependencies`, and keep them unless a peer range
excludes the new versions.

## Root dev tools: one install command

jest-expo 58 peers on `@react-native/jest-preset@^0.88.0-rc.3` and, from 58.0.7, on `jest@^30.0.0`.
Installing it alone failed in the 2026-09-28 rehearsal:

```text
npm error ERESOLVE unable to resolve dependency tree
npm error Found: @react-native/jest-preset@0.86.3
npm error Could not resolve dependency:
npm error peer @react-native/jest-preset@"^0.88.0-rc.1" from jest-expo@58.0.3
```

Install every SDK-tracking root tool in one command (versions from the new module map, the React
line and the Jest line):

```sh
npm install -D jest-expo@58.0.7 eslint-config-expo@58.0.4 @react-native/jest-preset@0.88.0-rc.3 \
  @react-native/eslint-plugin@0.88.0-rc.3 @types/react@19.3.0 test-renderer@1.3.0 \
  jest@30 babel-jest@30 @types/jest@30.0.0
```

Never `--force` or `--legacy-peer-deps`. TypeScript stays on 6.0.

## One version of every native module: overrides

A single app normally needs no `react` or `react-native` override; every key the root `overrides`
already has moves to the version `npx expo install --fix` installed (`npm ls <pkg>`), or npm keeps
forcing the old one (`check-sdk-alignment` rule `overrides`). When multi-package, the 2026-09-28 rehearsal showed
the trap: after the apps moved, npm kept `react-native-reanimated` 4.5.1 and `react-native-worklets`
0.10.x at the root for a shared package's `"*"` peers and nested 4.7.0 and 0.13.0 under the app;
`npm dedupe` did not help, and `npx expo-doctor` failed:

```text
✖ Check that no duplicate dependencies are installed
Found duplicates for react-native-reanimated:
  ├─ react-native-reanimated@4.7.0 (at: node_modules/react-native-reanimated)
  └─ react-native-reanimated@4.5.1 (at: ../../node_modules/react-native-reanimated)
```

The fix (expo-doctor clean afterwards): root `overrides` for `react`, `react-native`,
`react-native-reanimated`, `react-native-worklets` and every `"*"` peer at the version the apps
install, then `npm install`. `check-sdk-alignment` reads `package-lock.json` and fails
`duplicate-native` on any native module installed twice; its fix line names the version the app
installs, not the floor of its range. The same duplicate can appear without any SDK move: a shared
package's new `"*"` peer added without its override leaves npm's newest release at the root on the
first install.

## Config plugins: expo now has an exports map

SDK 57's `expo` package has no `exports` map, so Node ESM (an `app.config.ts` and its local plugins
run under Node type stripping) needs `import … from 'expo/config-plugins.js'`. SDK 58's `expo` has
one (`"./*": { "types": "./*.d.ts", "default": "./*.js" }`, verified in 58.0.3), so the old import
resolves to `config-plugins.js.js`:

```text
PluginError: Cannot find module '…/node_modules/expo/config-plugins.js.js'
plugins/with-variant-marker.ts(2,31): error TS2307: Cannot find module 'expo/config-plugins.js'
```

`npx expo config`, `expo-doctor` and `expo export` all failed in the 2026-09-28 rehearsal until every local
plugin imported `'expo/config-plugins'` (type imports too). The same holds for every test and test
helper that imports it (a config-plugin test helper fails in Jest with `config-plugins.js.js` and in
tsc with TS2307). Change it in the move commit, not before:
on SDK 57 the bare specifier does not resolve in Node. `expo/metro-config`, `expo/config` types and
`"extends": "expo/tsconfig.base"` keep working.

## Jest: the Reanimated resolver and the asset-registry mapping

With Reanimated 4.7 and Worklets 0.13, an unchanged Jest setup (Gesture Handler's `jestSetup`, the
Worklets mock, `require('react-native-reanimated').setUpTests()`) failed every suite in the 2026-09-28 rehearsal:

```text
[Reanimated] `setCSSEventHandler` is not available in JSReanimated.
  at initializeReanimatedModule (node_modules/react-native-reanimated/src/initializers.native.ts:21:21)
```

Mocking Reanimated (`require('react-native-reanimated/mock')`) fails the same way, because the mock
imports the real index. Reanimated's testing guide prescribes its Jest resolver, which makes Jest pick
the web implementations. With it alone, jest-expo 58's own mapping broke, because React Native 0.88's
exports map exposes `./asset-registry` but not `./src/*`:

```text
Could not locate module react-native/asset-registry mapped as: react-native/src/asset-registry.
```

Both changes together made every suite pass, plus a render of an `Animated.View` using
`useSharedValue`. In the canonical root config (unit-and-component-tests owns it):

```js
// jest.config.js (SDK 58): two additions
const PATH_ALIASES = {
  // jest-expo 58 maps this to react-native/src/asset-registry, which React Native 0.88's exports map
  // hides from the Reanimated resolver; point it at the file itself.
  '^react-native/asset-registry$': '<rootDir>/node_modules/react-native/src/asset-registry.js',
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/test/$1',
};

const SHARED = {
  rootDir: __dirname,
  preset: 'jest-expo/ios',
  // Reanimated 4.7 / Worklets 0.13: pick the non-native (web) implementations under Jest.
  resolver: 'react-native-reanimated/jest/resolver',
  moduleNameMapper: PATH_ALIASES,
  // ...the rest unchanged
};
```

`jest.config.js` is a gated path: the move commit carries a `Gate-Change:` trailer.
`check-sdk-alignment` checks both lines (`jest-config`). Rerun the golden project (Skia's
`jestEnv.js` and `jestSetup.js`) and any simulation project too.

## Jest 30

jest-expo 58.0.7 (in expo 58.0.3's map) peers on `jest@^30.0.0` and depends on Jest 30 packages and
on `test-renderer` 1.3.0; jest-expo 58.0.6 and earlier had no jest peer (and depended on Jest 29 packages:
Jest 29 by Expo's versions API). Expo's versions API still listed
`jest ~29.7.0` on 2026-10-04, but npm enforces the peer. What changes (read in Jest 30.5.2):

- **Alias matchers are gone:** `toBeCalled`, `toBeCalledTimes`, `toBeCalledWith`, `lastCalledWith`,
  `nthCalledWith`, `toReturn`, `toReturnTimes`, `toReturnWith`, `lastReturnedWith`,
  `nthReturnedWith`, `toThrowError`. Use the full names (`toHaveBeenCalledWith`, `toThrow`, …), which
  Jest 29 has too, so `check-sdk-alignment --target-sdk 58` fails `removed-test-api` before the move.
- **`jest.genMockFromModule` is gone:** use `jest.createMockFromModule`.
- **The CLI flag `--testPathPattern` is `--testPathPatterns`** (scripts and CI that pass it).
- **Snapshot files** carry a new header link (`https://jestjs.io/docs/snapshot-testing` where Jest 29
  wrote `goo.gl/fbAQLP`), and `jest --ci` fails on every `.snap` file that still has the old header
  (CI never writes snapshots). Rewrite the header of every `__snapshots__/*.snap` file in the move
  commit (golden-and-snapshot-tests' policy reference, "Jest upgrades", has the command) and check
  that the diff is that header only; anything else is reviewed like a golden.
- `babel-jest` in `devDependencies` moves with `jest` (same major; `sdk-tooling` checks it), and so
  does `@types/jest` (30.0.0).
- React Native Testing Library 14 (`jest >=29`) and jest-image-snapshot 6.5 (`jest >=20 <31`) accept
  Jest 30.

## Gesture Handler 3: hooks replace the builder

RNGH 3 still exports the builder (`Gesture.Tap()`, now typed `LegacyTapGesture` and friends) as
deprecated, but hook gestures and builder gestures cannot be related to each other (no
`Exclusive`/`Simultaneous` between the two kinds), so every component that builds gestures moves to
hooks as a whole, in the move commit:

| RNGH 2.32 builder | RNGH 3 hook |
|---|---|
| `Gesture.Tap()`, `Gesture.Pan()`, `Gesture.LongPress()` … | `useTapGesture({...})`, `usePanGesture({...})`, `useLongPressGesture({...})` |
| `.onStart(cb)` | `onActivate` |
| `.onEnd((e, success) => …)` | `onDeactivate: (e) => { if (e.canceled) return; … }` |
| `.onChange(cb)` | merged into `onUpdate` |
| `Gesture.Exclusive(a, b)` / `Simultaneous` / `Race` | `useExclusiveGestures(a, b)` / `useSimultaneousGestures` / `useCompetingGestures` |
| types `TapGesture`, `ExclusiveGesture` | `LegacyTapGesture`, `LegacyExclusiveGesture` (builder) |

This shape type-checked against RNGH 3.2.1 in the 2026-09-28 rehearsal (and `e.cancelledX` was rejected, so the
event shape is real):

```tsx
import { View } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';

type SwipeRowProps = { readonly onComplete: () => void };

export function SwipeRow({ onComplete }: SwipeRowProps): React.JSX.Element {
  const tap = useTapGesture({
    onDeactivate: (event) => {
      if (event.canceled) {
        return;
      }
      onComplete();
    },
  });
  const pan = usePanGesture({ onUpdate: () => undefined });
  return (
    <GestureDetector gesture={useExclusiveGestures(pan, tap)}>
      <View />
    </GestureDetector>
  );
}
```

Keep each component's gesture contract (what one gesture may produce, how it hit-tests, how it
reaches JS from a worklet with `scheduleOnRN`) and rerun its gesture tests; check their helpers
against the 3.x testing guide (`react-native-gesture-handler/jestSetup` still exists in 3.2.1).
`check-sdk-alignment` fails `gesture-api` on any `Gesture.<Kind>(` call once the app is on RNGH 3,
and on v3 hook imports while it is on RNGH 2. Canvas and game gestures: canvas-gestures-and-hit-testing.

## Reanimated 4.7 and Worklets 0.13 at runtime

- Peer ranges (npm, 2026-10-04): Reanimated 4.7.0 needs `react-native-worklets` 0.13.x and React
  Native 0.86 to 0.88; Worklets 0.13.0 needs React Native 0.86 to 0.88.
- The current APIs stay: `.get()`/`.set()` on shared values, `scheduleOnRN` instead of `runOnJS`, the
  `'worklet'` directive. Recheck them in the versioned docs anyway (motion-and-animation).
- Code that depends on frame-callback timing (`useFrameCallback`, `timeSinceFirstFrame` on
  re-activation) is reread against the 4.7.0 source and its tests rerun: such details change between
  minors without a changelog line.

## Skia 2.13

- No install script since Skia 2.6.5 (2.6.2 and 2.6.4 run `node scripts/install-libs.js`; 2.6.5 and
  2.13.1 have none): delete a `true` approval for `@shopify/react-native-skia@2.6.x` from
  `allowScripts`; `check-sdk-alignment` fails `skia-approval` while it is there.
- Pixel goldens will shift with a new Skia: look at every diff, re-accept only intended changes with a
  `Gate-Change:` trailer (golden-and-snapshot-tests).
- Recheck the APIs the app draws with against the 2.13 types (skia-canvas-rendering); in the
  2026-09-28 rehearsal (2.11.2) `<Canvas onLayout>` still threw on the New Architecture (keep `onSize`) and the
  `jestEnv.js`/`jestSetup.js` files still shipped.

## React 19.3, test-renderer 1.3, @types/react 19.3

- `react` 19.3.0 comes from the module map; any root override follows it.
- `test-renderer` 1.2.x is the React 19.2 line; jest-expo 58.0.7 depends on `test-renderer` 1.3.0, so
  the root devDependency moves to 1.3.0 too (one copy).
- Expo's related packages for SDK 58 list `@types/react ~19.3.0` (19.3.0, published 2026-09-09).
- React Native Testing Library stays on 14 (its async API is unchanged); rerun the component tests.

## React Native 0.88: removed and changed APIs

Read in the 0.88.0-rc.3 source:

| API | In 0.88 | Fix |
|---|---|---|
| `InteractionManager` | removed; in development it throws "InteractionManager has been removed from react-native core. Please refactor long tasks into smaller ones, and use 'requestIdleCallback' instead." | split the task and use `requestIdleCallback` |
| `Modal` `animated` prop | removed | `animationType="none" \| "slide" \| "fade"` |
| `StatusBar` `backgroundColor`, `translucent`, `setBackgroundColor`, `setTranslucent` | removed | delete them; Android is edge to edge: colour the view behind the bar and use safe-area insets |
| `useColorScheme()` | returns `'light' \| 'dark' \| null` | handle `null`; `tsc` flags comparisons with `'unspecified'` |
| package `exports` map | `react-native/Libraries/*` and `react-native/asset-registry` are exported, `react-native/src/*` is not | no deep imports (the lint config already bans them) |

`check-sdk-alignment --target-sdk 58` finds the first three in source before the move
(`removed-rn-api`); fix them on SDK 57, where the replacements already work. During the 2026-09-28 rehearsal's
`expo export` Metro printed "Attempted to import the module …/react-native/src/private/featureflags/
ReactNativeFeatureFlags which is not listed in the exports": a warning from a dependency; the bundle
was correct.

## Expo Router 58: usePreventRemove

Reported by navigation-and-routing's build (expo-router ~58.0.13 on npm `next`, read at that skill's
build; not rehearsed here):

| SDK 57 | SDK 58 | Fix |
|---|---|---|
| `import { usePreventRemove } from 'expo-router/react-navigation'` | exported from `expo-router` | change the import |
| the callback receives the blocked action and calls `navigation.dispatch(action)` to leave | the callback receives `repeat()`; set the guard's condition to false first, then call `repeat()` | rewrite the callback |
| nothing returned | the hook returns `disablePrevention` | use it where the screen leaves on purpose (after a save) |
| the `beforeRemove` listener | removed | move every `beforeRemove` listener to `usePreventRemove` |

The canonical discard guard is navigation-and-routing's `use-discard-guard.ts` with its two tests:
move it and its tests in the move commit, and rerun the route tests that leave a dirty form. `rg
"usePreventRemove|beforeRemove" src` lists every caller before the move.

## Android: compileSdk 37 and AGP 9

From React Native 0.88.0-rc.3's `gradle/libs.versions.toml` (SDK 57's 0.86.3 in brackets):
compileSdk 37 (36), buildTools 37.0.0 (36.0.0), targetSdk 36 (36), minSdk 24 (24), AGP 9.2.1
(8.12.0), Kotlin 2.2.0 (2.1.20), NDK 27.1.12297006 (same); JDK 17 for both.

- An `expo-build-properties` `compileSdkVersion: 36` pin left from SDK 57 holds the build back:
  delete it (`check-sdk-alignment` fails `android-sdk` on SDK 58 and prints a `todo` in readiness).
- AGP 9 is a major: a local config plugin that edits `build.gradle` or `gradle.properties`, and every
  library with native Android code, is rebuilt and read for warnings; a library that does not build on
  AGP 9 yet blocks the move like any package that is not out.
- The EAS image for SDK 58 Android builds is `ubuntu-26.04-jdk-17-ndk-r27b-sdk-58` (alias `sdk-58`).
- Rebuild on a named emulator after `npx expo prebuild --platform android --clean` (android-emulator-build).

## iOS: scene support, Xcode, EAS images

- `ios.enableSceneSupport` is not needed from SDK 58 ("Expo SDK 58 and newer include scene lifecycle
  support, so this property is no longer required and can be removed", v58 build-properties docs):
  remove the call, the helper and its test in the move commit (`scene-support`).
- Xcode: SDK 58 needs Xcode 26.4 or newer (the v58 docs versions table, read 2026-10-04); the EAS `sdk-58` alias is
  `macos-tahoe-26.6-xcode-27.0` (Xcode 27.0), so SDK 58 builds with Xcode 27 as well.
- `npx expo-doctor` ran 20 checks on SDK 58 and 21 on SDK 57 in the 2026-09-28 rehearsal.

## Confirm at move time

When the trigger is met, re-read the values from the stable release and update the app's data in the
same commit (references/sdk-lines.md):

```sh
node -p "require('expo/package.json').version"                    # after the move
node -p "JSON.stringify(require('expo/bundledNativeModules.json'), null, 2)" > reports/expo-58-module-map.json
npm view jest-expo@<map version> peerDependencies dependencies     # the Jest line and test-renderer
grep -E '^(minSdk|targetSdk|compileSdk|agp|kotlin) ' node_modules/react-native/gradle/libs.versions.toml
npm view react-native-gesture-handler@<map version> version         # and every other map entry the app uses
```

Then read the release notes of Expo SDK 58, React Native 0.88, Reanimated 4.7, Gesture Handler 3,
Skia 2.13 and Jest 30 for anything this list does not cover, and put each finding in the move report.
