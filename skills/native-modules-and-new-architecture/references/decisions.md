# Decisions: when to write native code, with which API, and where it lives

The defaults this skill sets, each with the reason, and the alternatives it fences off. Facts were
verified on 2026-10-14 against Expo SDK 57 (`expo` 57.0.26, `expo-modules-core` 57.0.20,
`expo-modules-autolinking` 57.0.13) and React Native 0.86.3, by reading the installed packages and the
docs named below. Re-verify after an SDK move with `npm view expo-module-template dist-tags` and
`npx expo-modules-autolinking --version` inside the app.

## Contents

- 1. The order of reach: native code comes last
- 2. One API: the Expo Modules API in a local module
- 3. When a Turbo Module instead
- 4. Not the legacy bridge, not inline modules
- 5. Where every file lives
- 6. One binding per module, in its adapter: typed, lazy, optional
- 7. The binding type is the cross-language contract
- 8. Platform differences are declared, not discovered
- 9. Native views
- 10. A native change is a new binary
- 11. Decisions that need the developer

## 1. The order of reach: native code comes last

Before any Swift or Kotlin, walk this list and stop at the first hit:

1. **An Expo SDK package** (`npx expo install expo-<x>`): Expo tests it with the SDK, it is an Expo
   module (New Architecture by construction), and SDK moves update it for you.
2. **A maintained library that runs on the New Architecture natively** (an Expo module, or
   `codegenConfig` in its `package.json`): check it with `check-native-libraries.mjs` and
   `npx expo-doctor` before installing (library-compatibility.md), and install it with
   dependency-management's procedure.
3. **A config plugin** when the need is configuration, not code (an `Info.plist` key, a manifest
   entry, an entitlement): expo-prebuild-and-config-plugins.
4. **A local Expo module** (`modules/<name>/`) when the app needs code the platform has and no package
   exposes. This skill.
5. **A local Turbo Module package** only for the cases in section 3.

Why: every native line is code the app now owns on two platforms, through every SDK and OS move,
without Fast Refresh, and outside Jest. A package someone else maintains costs less until it does not
run on the New Architecture.

## 2. One API: the Expo Modules API in a local module

The default for app-owned native code is a **local Expo module** created by
`npx create-expo-module@latest --local` and written with the Expo Modules API: one Swift class and one
Kotlin class, each `Module` with a `definition()` built from `Name`, `Function`, `AsyncFunction`,
`Property`, `Constant`, `Events` and the lifecycle components (expo-modules-api.md).

Why this and not a hand-written Turbo Module:

- **New Architecture by construction.** Expo's New Architecture guide states that every module
  written with the Expo Modules API supports it, with no extra work, and that SDK 55 and later run
  only on it. No codegen step, no generated protocol to keep in sync (and no cross-platform type
  generation either: section 7).
- **The same DSL on both platforms.** Swift and Kotlin read almost line for line, which makes the
  parity rule (section 8) cheap to keep and to check.
- **Autolinking with no app edit.** Expo autolinking scans `./modules` (the `nativeModulesDir`
  default) and registers the classes `expo-module.config.json` lists; nothing touches the generated
  `ios/` and `android/` folders, which Continuous Native Generation deletes on every clean prebuild.
- **Lifecycle hooks without patching generated code.** AppDelegate subscribers (iOS) and `Package`
  lifecycle listeners (Android) replace the "paste this into AppDelegate/MainApplication" step of
  older libraries.

## 3. When a Turbo Module instead

Write a local Turbo Module package (`modules/<name>/` with its own `package.json` `codegenConfig`)
only when one of these holds:

- **Shared C++**: one C++ implementation both platforms call (a parser, a checksum, a search index),
  where the Expo Modules API would need a Swift and a Kotlin wrapper around the same C++ anyway.
- **A library for non-Expo apps**: the module will be published for bare React Native apps that do not
  install `expo-modules-core`.
- **A codegen-checked contract matters more than a short DSL**: codegen generates the Objective-C++
  protocol and the Java base class from the TypeScript spec, so a renamed method fails to compile.

The cost: a spec file per module, a codegen step in both builds, Objective-C++ on iOS, a CMake build
and a JNI bridge on Android to reach the shared C++, a different podspec location (the package root,
not `ios/`), and more files to keep in sync by hand.
turbo-modules-and-codegen.md has the details; examples/turbo-module/ is the shape.

## 4. Not the legacy bridge, not inline modules

- **Legacy bridge modules** (`RCT_EXPORT_MODULE`, `RCT_EXPORT_METHOD`, `ReactContextBaseJavaModule`,
  `@ReactMethod`, `ReactPackage`, `RCTViewManager`) are never written new. React Native 0.82 made the <!-- stack-pin-ignore: the release that changed it -->
  New Architecture the only one; in 0.86.3 such code runs only through the interop layers
  (`LegacyViewManagerInterop`, the TurboModule interop flag), which React Native keeps "for the
  foreseeable future" but has announced it will remove. The checker's `legacy-native-api` rule finds
  them in `modules/`; library-compatibility.md covers third-party packages built that way.
- **Inline modules** (`expo.experiments.inlineModules`, Swift and Kotlin files beside routes and
  screens) are experimental in Expo SDK 56 and later, with an API "subject to breaking changes". They
  also put native code inside `src/`, where the architecture rules, the reviewers and every checker
  expect TypeScript only. The checker's `native-placement` rule reports both the config key and native
  files outside `modules/`.

## 5. Where every file lives

```
modules/<name>/                      the local Expo module (kebab-case folder, e.g. time-change)
  expo-module.config.json            platforms + the classes autolinking registers
  ios/<Pascal>.podspec               depends on ExpoModulesCore; source_files **/*.swift
  ios/<Pascal>Module.swift           the definition: thin, delegates to plain Swift
  ios/<Pascal>System.swift           what the OS says, in Foundation/UIKit only (type-checks alone)
  android/build.gradle               com.android.library + expo-module-gradle-plugin, namespace
  android/src/main/AndroidManifest.xml
  android/src/main/java/expo/modules/<lower>/<Pascal>Module.kt
  android/src/main/java/expo/modules/<lower>/<Pascal>System.kt    android.* only (compiles alone)
src/services/<concern>/
  <concern>-port.ts                  vendor-neutral port: Result failures, an unsubscribe for events
  native-<concern>-adapter.ts        the ONE binding of the module + mapping native errors to failures
  native-<concern>-adapter.test.ts   the adapter against a stand-in native object (Jest)
  fake-<concern>.ts (+ test)         the port's in-memory fake for every test above the adapter
contracts/native-libraries.json      decisions about third-party libraries on the interop layer
```

- The module folder holds **native code and its config only**. `create-expo-module --local` also
  writes `src/<Pascal>Module.ts`, `src/<Pascal>.types.ts` and `src/<Pascal>Module.web.ts`: delete them
  and bind in the adapter (section 6). Why: the scaffold's `export default requireNativeModule(...)`
  runs at import time and throws wherever the module is missing; and an import of `@/modules/<name>`
  needs the alias in three files (architecture-and-boundaries rule 11), while a binding by name needs
  none.
- The adapter is named `native-<concern>-adapter.ts`: "native" is the library, the local module is
  the SDK behind the port, exactly as architecture-and-boundaries treats it (only the adapter reaches
  the module, the composition root creates the adapter once, tests use the fake).
- `modules/*/ios` and `modules/*/android` are source and are committed; the root `.gitignore` ignores
  only `/ios` and `/android`, anchored (expo-prebuild-and-config-plugins owns that rule).
- **Configuration the checkers read.** The modules folder is `package.json`
  `expo.autolinking.nativeModulesDir` (what autolinking reads; default `./modules`), or
  `--modules-dir <dir>`. Native source that legitimately lives elsewhere, such as an app extension
  target (a widget) that a config plugin adds, is listed in `rn-skills.config.json`
  `"nativeSourceDirs": ["targets"]` (a decision for the developer); `native-placement` then leaves those
  folders alone. The decisions file is `<contractsDir>/native-libraries.json` (`contractsDir` from
  `rn-skills.config.json`, default `contracts`), or `--contract <file>`.

> **When native folders are committed** (a bare app, or one that left Continuous Native Generation;
> DECISIONS keeps that an alternative, not the default). The checkers' repo walk skips the app's own
> `ios/` and `android/` as build output, so `native-placement` and `legacy-native-api` never read
> hand-written code there: a legacy `RCT_EXPORT_MODULE` in `ios/` passes. New native code still goes in
> `modules/<name>/`, where the rules hold and autolinking links it the same way in a bare app; review
> code already in `ios/` and `android/` by hand (`grep -rnE "RCT_EXPORT_MODULE|ReactContextBaseJavaModule|@ReactMethod" ios android`)
> and move what you touch into a module.

## 6. One binding per module, in its adapter: typed, lazy, optional

```ts
export function createNativeTimeChangeAdapter(
  native: TimeChangeBinding | null = requireOptionalNativeModule<TimeChangeBinding>('TimeChange'),
): TimeChangePort { ... }
```

- **One place.** `requireOptionalNativeModule`, `requireNativeModule` and `requireNativeView` appear
  only in adapters (`src/services/**/*-adapter.ts(x)`, `src/data/**/*-adapter.ts`) and the module
  folder (`binding-place`), and only one adapter binds each name (`binding-unique`; another file
  that needs the module takes that adapter's port); `TurboModuleRegistry` appears only in a codegen spec file (`codegen-spec`),
  and an adapter binds a Turbo Module with `requireOptionalNativeModule` too. Why: the
  binding is the only line that reaches native code; one per module means one place to guard, map and
  review, and every caller above it is testable with the port's fake.
- **Lazy.** The lookup runs when the composition root calls the factory, never at module scope
  (`binding-lazy`). Why: a module-scope lookup runs whenever any file imports the adapter: the
  composition root's own test, a web bundle, a story; and it runs before the app can decide anything.
- **Optional.** `requireOptionalNativeModule` returns `null` where the module is missing; the port then
  answers a typed `unavailable` failure (`binding-optional`). Why: the module is missing in Jest (the
  jest-expo preset's `requireNativeModule` throws `Cannot find native module '<Name>'` for an app
  module, verified with `expo-modules-core` 57.0.20), on web, in a dev client or store build made before
  the module existed, and when an update reaches a binary without it. `requireOptionalNativeModule`
  itself looks in `globalThis.expo.modules`, then the legacy proxy, then `TurboModuleRegistry.get`, and
  logs a warning and returns `null` if the lookup throws (read in `requireNativeModule.ts`).
- **The default parameter is the seam.** The composition root passes nothing; the adapter's test
  passes a stand-in object (or `null`) and proves the mapping in Jest without mocking `expo`. The
  template's test also proves that the default lookup returns `null` under jest-expo.

## 7. The binding type is the cross-language contract

The Expo Modules API has no cross-platform codegen: nothing but discipline ties `getTimeZoneId()` in TypeScript to
`Function("getTimeZoneId")` in Swift and Kotlin. A typo compiles everywhere and fails at runtime with
"is not a function", on one platform or both. So:

- The binding type (`TimeChangeBinding`) is declared in the adapter, beside the binding, and lists
  every member and event the native definitions export, by the native names (`binding-type`).
- `check-native-modules.mjs` reads the Swift and Kotlin definitions and compares: a member or event on
  one side only is `contract-drift`; a member on one platform only is `platform-parity` unless the
  binding marks it optional.
- Edit the binding type and both native files in the same change; check-native-modules enforces it.

**Drafting the type from Swift.** `expo-type-information` (SDK 56 and later; macOS only; needs
`brew install sourcekitten`) reads a Swift Expo module and writes TypeScript
(`npx expo-type-information module-interface -m modules/<name> -o <dir>`). It can draft the binding
type, with three limits: it reads Swift only, so the Kotlin definition stays unchecked by it; its
`module.ts` binds with `requireNativeModule` at module scope, which breaks rules 5 and 6 (copy only the
type into the adapter, never the generated binding); and its inference levels can fail on some modules
(fall back to `-t SIMPLE_INFERENCE`). Treat its output as a first draft; `check-native-modules` stays
the gate that compares the type with both platforms.

## 8. Platform differences are declared, not discovered

A module listed for iOS and Android exports the same surface on both (`platform-parity`). When a
platform truly lacks a capability (iOS has no public "set time automatically" setting), the member
exists on the other platform only, is optional in the binding type
(`isAutomaticTimeEnabledAsync?(): Promise<boolean>`), and the adapter maps its absence to a typed
`unsupported` failure. A module that exists on one platform only says so in `platforms`, and the
optional binding makes the other platform's port answer `unavailable`.

## 9. Native views

A native view is `View(SomeExpoView.self) { Prop(...); Events(...) }` in the definition and
`requireNativeView<Props>('<Name>')` in TypeScript. The binding rules hold for views too: one
`requireNativeView` per view, in an adapter (`native-<concern>-adapter.tsx`), never at module scope.
The port then carries the component (`readonly TaskChart: ComponentType<TaskChartProps>`), the
composition root provides it, and the fake provides a plain `View` stand-in with the same props, so
screens render in Jest. Prefer an existing view package (expo-image, Skia, the Expo UI components)
before writing a native view: a view is the most expensive native code to keep correct on both
platforms (layout, accessibility, RTL, dark mode).

## 10. A native change is a new binary

Native code never reaches users through an over-the-air update: a change under `modules/` needs a new
dev client (`npx expo run:ios`, `npx expo run:android`, or an EAS development build) and a new store
build. Two consequences:

- Fast Refresh reloads the TypeScript side only; after editing Swift or Kotlin, rebuild.
- An update published for the new JavaScript must not reach binaries without the module. The
  fingerprint hashes the module's native folders (`npx @expo/fingerprint fingerprint:generate
  --platform ios` lists `modules/time-change/ios` as an `expoAutolinkingIos` source and a Turbo Module
  package as `rncoreAutolinkingIos`, verified 2026-10-14), so a fingerprint runtime version changes
  with them (ota-updates owns that policy). The optional binding is the second line: an old binary
  that still gets the JavaScript answers `unavailable` instead of crashing at startup.

## 11. Decisions that need the developer

Stop and ask before: writing a new native module (is there a package?), choosing a Turbo Module over an
Expo module, keeping a library on the interop layer (a `contracts/native-libraries.json` entry with a
recheck date), excluding a package from expo-doctor's directory check, or adding a folder to
`nativeSourceDirs` (an app extension such as a widget target). Each binds the app for releases to come.
