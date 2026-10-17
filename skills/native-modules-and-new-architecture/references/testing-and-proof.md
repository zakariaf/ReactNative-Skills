# Testing native code and proving it builds

What can be proven where, from Jest to a device, and the commands that prove each layer. Every command
below was run on 2026-10-14 on macOS with Xcode 26.6 (Swift 6.3.3), Node 26.4, a copy of the reference
app (Expo SDK 57, `expo-modules-core` 57.0.20) and the Android SDK's `android-36` platform, unless the
section says otherwise.

## Contents

- 1. The layers
- 2. Jest: the fake, the adapter, the lazy optional binding
- 3. The cross-language contract
- 4. Linking, without a build
- 5. Swift: type-check the module against the prebuilt core
- 6. Kotlin: compile the helpers against android.jar
- 7. On a device
- 8. Problems and fixes

## 1. The layers

| Layer | Proves | Tool |
|---|---|---|
| Port fake | everything above the adapter (model hooks, stores, screens) | Jest, `fake-<concern>.ts` |
| Adapter | the mapping: null module → `unavailable`, native throw → failure with its code, a member one platform lacks → `unsupported`, events in, unsubscribe out | Jest, a stand-in native object |
| Binding | typed, lazy, optional, in one place; the binding type equals the Swift and Kotlin definitions | `check-native-modules.mjs` |
| Linking | autolinking finds the module and its classes on both platforms | `npx expo-modules-autolinking resolve` |
| Native compile | the Swift and Kotlin compile | `swiftc -typecheck`, `kotlinc`, then a dev build |
| Behaviour | the OS delivers what the module claims | a dev client on a named simulator and emulator; e2e-maestro flows; a written manual check for what no flow can trigger |

## 2. Jest: the fake, the adapter, the lazy optional binding

- Every test above the adapter uses the port's fake through `createTestServices({ timeChange:
  createFakeTimeChange() })` (unit-and-component-tests owns the render helpers). Never `jest.mock()`
  the app's own adapter, and never a root `__mocks__/` file for a local module: there is no package to
  mock, and the fake is smaller and honest about failures.
- The adapter's test passes a stand-in object with the binding type's members to the factory's
  default parameter. It covers the null module, a native throw (an `Error` with a string `code`, as
  both platforms reject), the platform-only member, an unknown event payload, and that the
  unsubscribe removes the native listener.
- The template's test also calls the factory with no argument: under jest-expo
  `requireOptionalNativeModule('TimeChange')` returns `null` (the preset's mock looks for a
  `mocks/TimeChange` file beside the nearest `package.json`, then the real lookup, which finds no JSI
  module) and the port answers `unavailable`. `requireNativeModule` in the same place throws
  `Cannot find native module 'TimeChange'`: that is the crash `binding-optional` prevents (read in
  `jest-expo/src/preset/setup.js` 57.0.5 and proven by the template test in the reference app).
- Expo's module-author route (a `mocks/<Name>.ts` file beside a module's `package.json`, generated with
  `npx expo-modules-test-core generate-ts-mocks`, which needs SourceKitten) serves published modules;
  a local module behind a port does not need it.

## 3. The cross-language contract

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-native-modules.mjs .
```

It reads every `modules/<name>/` (config, Swift and Kotlin classes, the definition components at the
top level of `definition()`), every binding in `src/` and `modules/`, and the binding type beside each
binding, then reports names, members and events that differ (`contract-drift`, `platform-parity`,
`module-name`, `binding-name`). It reads source text; it cannot see members a definition builds in a
loop or in a helper function, so keep `definition()` a flat list of components.

What else it reads, and where it stops (it is a text reader, not a type checker):

- **A Turbo Module's contract is its spec** (`binding-type`, `contract-drift`): an adapter typed with
  `import type { Spec }` from the module's `Native<Name>.ts` passes; a hand-written binding type is
  compared with the spec's `interface Spec` members both ways. A binding outside an adapter is reported
  once, as `binding-place`; its partial type is not compared with the native side.
- **UI work on the main thread** (`main-thread`): a UIKit or Android view call inside an explicit
  main-thread block (`DispatchQueue.main.async { }` / `.sync`, `MainActor.run { }`,
  `Task { @MainActor in }`; Kotlin `runOnUiThread { }`, `Handler(Looper.getMainLooper()).post { }`,
  `withContext(Dispatchers.Main) { }`) passes. `.runOnQueue(.main)` is still the preferred form: it
  states the queue once, on the definition. A dispatch through a helper function is not followed.
- **One binding per module** (`binding-unique`): the first adapter that binds a name owns it; another
  file binding the same name fails. Platform variants of one adapter (`-adapter.ios.ts`,
  `-adapter.android.ts`) count as one file.
- **Observation stops in the Module** (`observer-stop`): every `OnStartObserving("e")` needs an
  `OnStopObserving("e")` or the unnamed form, and any `OnStartObserving` needs an `OnDestroy`.
  `observer-release` separately checks that each file removes every observer it adds. Neither proves the
  stop closures call the helper's `stop()`; the device check in section 7 does.
- **Legacy JavaScript APIs** (`legacy-js-api`): named imports from `react-native`
  (`import { NativeModules } from 'react-native'`), `require('react-native').NativeModules` and a
  namespace import (`import * as RN from 'react-native'` then `RN.NativeModules`). It does not follow
  re-exports through another file or a value passed around (`const m = RN; m.NativeModules`), and it
  sees binding calls only under their own names: `import { requireNativeView as rnv } from 'expo'`
  hides `rnv('X')` from every binding rule. Review aliased imports of `expo` and `react-native` by hand.

## 4. Linking, without a build

```sh
npx expo-modules-autolinking resolve --platform apple --json     # pods: TimeChange, modules: TimeChangeModule
npx expo-modules-autolinking resolve --platform android --json   # classifier: expo.modules.timechange.TimeChangeModule
npx expo-modules-autolinking react-native-config --platform ios --json   # React Native (Turbo) modules
```

These run in seconds, read the same configuration the Podfile and Gradle use, and catch a wrong class
name or package before any build. A missing module in the output means: no `expo-module.config.json`,
the wrong `nativeModulesDir`, a podspec in the wrong place (a Turbo Module package keeps it at its
root), or the platform missing from `platforms`.

## 5. Swift: type-check the module against the prebuilt core

`expo-modules-core` 57.0.20 ships prebuilt XCFrameworks inside the npm package
(`prebuilds/output/{debug,release}/xcframeworks/ExpoModulesCore.tar.gz`), and `expo-modules-jsi` ships
`apple/Products/ExpoModulesJSI.xcframework`. With React Native's prebuilt `React.xcframework` (present
in the CocoaPods cache after one `pod install` with prebuilt React Native, under
`~/Library/Caches/CocoaPods/Pods/External/React-Core-prebuilt/`), the module's Swift type-checks
without building the app:

```sh
TMP=$(mktemp -d) && tar -xzf node_modules/expo-modules-core/prebuilds/output/debug/xcframeworks/ExpoModulesCore.tar.gz -C "$TMP"
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
REACT=$(ls -d ~/Library/Caches/CocoaPods/Pods/External/React-Core-prebuilt/*/React.xcframework/ios-arm64_x86_64-simulator | head -1)
xcrun swiftc -typecheck -sdk "$SDK" -target arm64-apple-ios16.4-simulator \
  -F "$TMP/ExpoModulesCore.xcframework/ios-arm64_x86_64-simulator" \
  -F node_modules/expo-modules-jsi/apple/Products/ExpoModulesJSI.xcframework/ios-arm64_x86_64-simulator \
  -F "$REACT" \
  modules/time-change/ios/*.swift
```

Verified: the template's `TimeChangeModule.swift` and `TimeChangeSystem.swift` type-check (exit 0), and
a planted `Functionx("hello")` fails with "cannot find 'Functionx' in scope". The prebuilt core was
built with Swift 6.3.1 and Xcode 26.6's compiler is 6.3.3: the compiler rebuilds the module from its
textual interface, so the minor-version gap works. Without the React framework the core's umbrella
header fails; the plain helper still type-checks alone (`xcrun swiftc -typecheck -sdk "$SDK" -target
arm64-apple-ios16.4-simulator modules/time-change/ios/TimeChangeSystem.swift`).

## 6. Kotlin: compile the helpers against android.jar

The helpers import only `android.*` and `java.*`, so any Kotlin compiler checks them against the
platform jar (verified with kotlinc 2.1.21, downloaded into a scratch folder, and `android-36`):

```sh
kotlinc -cp "$ANDROID_HOME/platforms/android-36/android.jar" -d /tmp/out \
  modules/time-change/android/src/main/java/expo/modules/timechange/TimeChange{System,Receiver}.kt
```

The `Module` class itself needs `expo-modules-core`'s Kotlin classes, which ship as source in the npm
package, not as a jar: it compiles in the Gradle build of a dev client. (This skill compiled it against
a signature stub copied from `ObjectDefinitionBuilder.kt` and `ModuleDefinitionBuilder.kt` 57.0.20,
which proves the syntax and the lambda labels such as `return@OnStartObserving`, not the real types.)

## 7. On a device

1. Build a dev client after every native change: `npx expo run:ios --device <udid>` /
   `npx expo run:android --device <serial>`, or an EAS development build. Name the device; never the
   booted one (ios-simulator-build and android-emulator-build own the device helpers).
2. Exercise every member on both platforms; check the `unsupported` path on iOS for a member only
   Android has.
3. Events the OS sends cannot all be triggered from a test: write the manual check. For the
   time-change module: open the app, change the time zone in Settings (iOS: General > Date & Time,
   turn off Set Automatically; Android: Settings > System > Date & time), return, and see the screen
   that shows "today" refresh; set the clock forward past midnight and see the day change.
4. A flow that a UI test can drive goes into `.maestro/` (e2e-maestro).

## 8. Problems and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find native module 'X'` at startup | `requireNativeModule` at import time in a binary without the module (Expo Go, an old dev client, web, Jest) | Bind lazily with `requireOptionalNativeModule` in the adapter factory; rebuild the dev client |
| The port answers `unavailable` on the device | the dev client predates the module; or `Name("...")` differs from the bound name; or the class is missing from `expo-module.config.json` | Rebuild; run the checker (`module-name`, `binding-name`, `module-class`); run `expo-modules-autolinking resolve` |
| `undefined is not a function` on one platform | the member exists on the other platform only | `platform-parity`: implement it, or mark it optional and map its absence |
| A Swift edit has no effect | Fast Refresh reloads JavaScript only | Rebuild (`npx expo run:ios`) |
| `pod install` does not see a new Swift file or config change | stale Pods in a prebuilt `ios/` | `npx pod-install`, or a clean prebuild |
| Events never arrive | no `OnStartObserving` work, or the listener is added for a different event name | `contract-drift` names event mismatches; start OS observation in `OnStartObserving` |
| Events keep arriving after the screen closed, or the module leaks | an observer or receiver never removed; the subscription never `remove()`d | `observer-release`, `observer-stop`; return the port's unsubscribe from the effect |
| Main Thread Checker warnings, UI glitches | UIKit or Android views touched from the JavaScript thread or a background queue | `main-thread`: `AsyncFunction(...).runOnQueue(.main)` / `Queues.MAIN` |
| A Turbo Module package is linked on Android but not iOS | its podspec is in `ios/` | Move it to the package root (`codegen-config`) |
