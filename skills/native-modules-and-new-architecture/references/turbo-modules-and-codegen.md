# Turbo Modules and codegen in an Expo app

When a Turbo Module is the right tool (decisions.md section 3) and how to build one as a local
package that Continuous Native Generation keeps. Verified on 2026-10-14: React Native docs
(Turbo Native Modules guide and the codegen appendix, versions 0.86 and 0.87), the
`expo-modules-autolinking` 57.0.13 sources (`reactNativeConfig/*.js`, `dependencies/scanning.js`) and
`expo-modules-core` 57.0.20 (`requireNativeModule.ts`, `TurboModuleToExpoModuleProxy.native.ts`).
**Not verified by a native build here**: autolinking resolution was proven offline (below); the
shared C++ and its JNI bridge were built with NDK 28.2 and CMake 3.22.1 (`android/CMakeLists.txt`,
arm64-v8a and x86_64, `-Wall -Wextra -Werror`), and the same bridge, built for macOS and loaded from
`TaskChecksumJni.kt` (kotlinc 2.1.21) in a JVM, returned the digests Node computes for ASCII, emoji
and NUL text. The Objective-C++, the Gradle wiring and the codegen step need a device build, which
this skill's verification did not run.
Re-verify with the commands in section 6 after an SDK move.

## Contents

- 1. What a Turbo Module is, and what codegen buys
- 2. The package layout under modules/
- 3. The spec file
- 4. codegenConfig
- 5. The native halves
- 6. Proving the linking without a build
- 7. Binding it from the app
- 8. Fabric components (codegenNativeComponent)
- 9. Rules the checker enforces

## 1. What a Turbo Module is, and what codegen buys

A Turbo Module is React Native's own New Architecture module: a TypeScript **spec** describes the
methods, **codegen** turns it into an Objective-C++ protocol and a Java abstract class, and the native
classes implement them. The compiler then checks the contract: a method renamed in the spec without
the native side fails the build. The Expo Modules API has no such cross-platform step
(`expo-type-information` drafts TypeScript from Swift only, decisions.md section 7; the contract is
checked by `check-native-modules.mjs` instead, `contract-drift`). Turbo Modules load lazily on first access
through JSI, like Expo modules.

## 2. The package layout under modules/

With Continuous Native Generation the app has no committed `ios/` or `android/`, so a Turbo Module
cannot live in the app's own native projects. It lives as a local package that Expo autolinking finds
in the `nativeModulesDir` (default `./modules`), exactly where local Expo modules live:

```
modules/task-checksum/
  package.json                 name, version, codegenConfig
  TaskChecksum.podspec         at the package ROOT (see below)
  src/NativeTaskChecksum.ts    the spec (codegenConfig.jsSrcsDir = "src")
  cpp/task-checksum.{h,cpp}    the shared C++ both platforms call
  ios/RCTNativeTaskChecksum.{h,mm}
  android/build.gradle         codegen (com.facebook.react) + externalNativeBuild
  android/CMakeLists.txt       libtaskchecksum.so from cpp/ and the JNI bridge
  android/src/main/cpp/task-checksum-jni.cpp
  android/src/main/java/com/example/taskchecksum/TaskChecksumJni.kt
  android/src/main/java/com/example/taskchecksum/NativeTaskChecksumModule.kt
  android/src/main/java/com/example/taskchecksum/NativeTaskChecksumPackage.kt
```

- **The podspec sits at the package root.** Expo autolinking resolves a React Native module's iOS
  side by looking for a `*.podspec` in the package folder itself (`iosResolver.js`, `findPodspecFile`
  of the package path), not in `ios/`. With the podspec in `ios/`, `react-native-config --platform ios`
  leaves the package out (verified). Expo modules are the opposite: their podspec lives in `ios/`.
- Autolinking scans `nativeModulesDir` first for React Native modules too
  (`createReactNativeConfigAsync`: "custom native modules should be resolved first"), so the package
  needs no `npm install`, no `file:` dependency and no `react-native.config.js`.

## 3. The spec file

```ts
// modules/task-checksum/src/NativeTaskChecksum.ts
import { TurboModuleRegistry } from 'react-native';

import type { TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  checksum(text: string): string;
}

export default TurboModuleRegistry.get<Spec>('NativeTaskChecksum');
```

- The file name starts with `Native` (codegen reads only `Native*` module specs and
  `*NativeComponent` component specs) and lies inside `codegenConfig.jsSrcsDir` (`codegen-spec`).
- `export interface Spec extends TurboModule` is what codegen parses.
- `TurboModuleRegistry.get` returns null where the module is missing; `getEnforcing` throws at import.
  This skill uses `get` for the same reasons as `requireOptionalNativeModule` (`binding-optional`).
  The default export at module scope is what codegen expects, so spec files are exempt from
  `binding-lazy`.
- Supported spec types (React Native 0.86 appendix): `string`, `boolean`, `number` (not nullable),
  object literals (`{ readonly id: string }`, preferred over `Object`), `Array<T>`, `Promise<T>`,
  callbacks (`(value: string) => void`), each nullable with `| null` except `number`. String unions
  (`'a' | 'b'`) are supported only as callbacks; enums are not listed.

## 4. codegenConfig

```json
"codegenConfig": {
  "name": "TaskChecksumSpec",
  "type": "modules",
  "jsSrcsDir": "src",
  "android": { "javaPackageName": "com.example.taskchecksum" },
  "ios": { "modulesProvider": { "NativeTaskChecksum": "RCTNativeTaskChecksum" } }
}
```

| Key | Meaning |
|---|---|
| `name` | the generated library name (`TaskChecksumSpec`: the iOS header `<TaskChecksumSpec/TaskChecksumSpec.h>`, the Android `libraryName`) |
| `type` | `modules`, `components` or `all` |
| `jsSrcsDir` | the folder codegen scans for specs, relative to the package |
| `android.javaPackageName` | the package of the generated Java spec class |
| `ios.modulesProvider` | maps the module name to the Objective-C class that provides it |

Codegen runs in the build: on Android the `generateCodegenArtifactsFromSchema` Gradle task (the
`com.facebook.react` plugin), on iOS a script phase CocoaPods adds during `pod install`.

**Never in the app's package.json** of a CNG app (`codegen-config`): the native half would have to live
in the generated `ios/` and `android/` folders, which a clean prebuild deletes.

## 5. The native halves

- **iOS** (`RCTNativeTaskChecksum.mm`): `@interface RCTNativeTaskChecksum : NSObject
  <NativeTaskChecksumSpec>`, the methods with the spec's names, `getTurboModule:` returning
  `std::make_shared<facebook::react::NativeTaskChecksumSpecJSI>(params)`, and `+ moduleName` returning
  `@"NativeTaskChecksum"`. The podspec calls `install_modules_dependencies(s)`, which adds React-Core,
  the codegen dependency and the New Architecture flags.
- **Android** (`NativeTaskChecksumModule.kt`): extends the generated `NativeTaskChecksumSpec`, returns
  the name from `getName()`, overrides each method. `NativeTaskChecksumPackage` extends
  `BaseReactPackage`, returns the module from `getModule` and declares `isTurboModule = true` in its
  `ReactModuleInfoProvider`. Autolinking registers the package (`packageInstance` in the
  `react-native-config` output).
- **Shared C++**: both halves call one C++ file, the reason the module is a Turbo Module at all
  (decisions.md section 3). iOS includes `cpp/task-checksum.h` from Objective-C++ (the podspec's
  `source_files` compile `cpp/`). Android reaches it through JNI: `android/CMakeLists.txt` builds
  `libtaskchecksum.so` from `cpp/task-checksum.cpp` and `android/src/main/cpp/task-checksum-jni.cpp`,
  `build.gradle` points `externalNativeBuild.cmake.path` at it, and `TaskChecksumJni.kt` loads the
  library and declares `@JvmStatic external fun checksum(utf8: ByteArray): String`, whose JNI symbol is
  `Java_com_example_taskchecksum_TaskChecksumJni_checksum`. Two details matter:
  - Pass bytes, not a `jstring`: `GetStringUTFChars` returns *modified* UTF-8 (a NUL is two bytes, an
    emoji six), so the digest would differ from iOS's `UTF8String` for exactly the texts nobody tests.
    Kotlin encodes with `toByteArray(Charsets.UTF_8)` and the bridge copies the array. The iOS half
    needs the same care: `std::string([text UTF8String])` stops at the first NUL, so the `.mm` builds
    the string with the explicit length (`std::string(bytes, [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding])`).
  - `-DANDROID_STL=c++_static` is safe here because only a C (JNI) interface crosses the library
    boundary; a library that shares C++ objects with React Native's own `.so` files uses `c++_shared`.
  Checked: "Buy milk" → `067e1bab4e2821ae` from the C++ (through JNI) and from Node. A C++ core that
  works on JSI types directly, with no Objective-C++ or Kotlin layer, is a pure C++ Turbo Module:
  expo-modules-autolinking 57.0.13 (`androidResolver.js`) links one on Android from the package's
  `react-native.config.js` (`cxxModuleCMakeListsModuleName`, `cxxModuleCMakeListsPath`,
  `cxxModuleHeaderName`). This skill has not verified that shape end to end; the example keeps the two
  platform layers, whose generated protocol and base class let the compiler check the spec on both.

## 6. Proving the linking without a build

```sh
npx expo-modules-autolinking react-native-config --platform ios --json      # lists "task-checksum" with podspecPath
npx expo-modules-autolinking react-native-config --platform android --json  # packageInstance, libraryName "TaskChecksumSpec"
```

Both outputs were checked on 2026-10-14 for examples/turbo-module placed in `modules/task-checksum`
of a copy of the reference app (Android: `"packageImportPath": "import
com.example.taskchecksum.NativeTaskChecksumPackage;"`, `"libraryName": "TaskChecksumSpec"`). The
package also appears in the fingerprint as an `rncoreAutolinkingIos` source. Then build a dev client
on a named simulator and emulator (ios-simulator-build, android-emulator-build) and call the module.

## 7. Binding it from the app

The adapter binds a Turbo Module with the same lazy, optional call as an Expo module, typed by the
spec itself, because the spec is the contract codegen and the compiler already check on both native
sides:

```ts
// src/services/task-checksum/native-task-checksum-adapter.ts
import { requireOptionalNativeModule } from 'expo';

import type { Spec } from '@/modules/task-checksum/src/NativeTaskChecksum';

export function createNativeTaskChecksumAdapter(native = requireOptionalNativeModule<Spec>('NativeTaskChecksum')) {
  return { checksum: (text: string): string | null => native?.checksum(text) ?? null };
}
```

In `expo-modules-core` 57.0.20 that lookup falls back to `TurboModuleRegistry.get(name)` and wraps the
Turbo Module in a proxy (`createTurboModuleToExpoProxy`), so one binding style covers both kinds of
module. The `import type` is erased at build time, so it needs only the TypeScript alias
`"@/modules/*": ["./modules/*"]` (architecture-and-boundaries rule 11), not the Babel or Jest ones.
`binding-type` accepts a type imported from the module's `Native<Name>.ts` (matched by the import
path's last segment). A hand-written binding type is allowed but is then compared with the
spec's `interface Spec` member by member (`contract-drift`), so a typo such as `checksumm` fails the
check instead of failing at runtime. Alternatively the adapter imports the spec's default export
(through the `@/modules/*` alias, which architecture-and-boundaries says lives in three files).
`binding-name` accepts the names a codegen spec registers.

## 8. Fabric components (codegenNativeComponent)

A Fabric component spec is `<Name>NativeComponent.ts` with `export default
codegenNativeComponent<NativeProps>('<Name>')`, in a package whose `codegenConfig.type` is
`components` or `all`; Android implements a `ViewManager` with the generated `<Name>ManagerInterface`
and delegate, iOS a component view. Prefer an Expo module `View` (expo-modules-api.md section 9) unless
the component must ship to non-Expo apps: it is far less code on both platforms.

## 9. Rules the checker enforces

| Rule | What |
|---|---|
| `codegen-config` | `name`, `type`, an existing `jsSrcsDir` holding a spec, `android.javaPackageName` when there is Android code, a root podspec when there is iOS code; no `codegenConfig` in the app's package.json |
| `codegen-spec` | `TurboModuleRegistry` only in `Native<Name>.ts` inside a `jsSrcsDir`, with `export interface Spec extends TurboModule` |
| `binding-optional` | `TurboModuleRegistry.get`, not `getEnforcing` |
| `binding-type`, `contract-drift` | the adapter's binding type is the spec's `Spec` (imported), or a hand-written type naming exactly the spec's members |
| `legacy-native-api` | a module class that is not a Turbo Module (no generated `Native*Spec`, no `getTurboModule:`) |
