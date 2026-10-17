# The Expo Modules API on SDK 57, for a local module

What a local module is made of and the definition components this skill uses, with iOS and Android
side by side. Verified on 2026-10-14 against `expo-modules-core` 57.0.20 (its Swift and Kotlin sources
in `node_modules/expo-modules-core/{ios,android}`), the sdk-57 module template that
`create-expo-module` 57.0.1 downloads (`expo-module-template` dist-tag `sdk-57`), and
docs.expo.dev/modules (Module API reference, module config, autolinking, mocking). Expo's official
`expo-module` skill is the complete API reference; this file is the subset the rules rely on.
Re-verify: `npm view create-expo-module dist-tags`, `npm view expo-module-template dist-tags`, and
`grep -n "func OnStartObserving" node_modules/expo-modules-core/ios/Api/Factories/ObjectFactories.swift`.

## Contents

- 1. Creating the module
- 2. expo-module.config.json
- 3. The definition, component by component
- 4. Types across the boundary
- 5. Threads and queues
- 6. Events: Events, sendEvent, OnStartObserving
- 7. Errors
- 8. Lifecycle, AppDelegate subscribers, Android lifecycle listeners
- 9. Views and shared objects
- 10. The JavaScript side: binding, typing, listening
- 11. iOS and Android differences that bite

## 1. Creating the module

```sh
npx create-expo-module@latest --local time-change --name TimeChange \
  --platform apple android --features Function AsyncFunction Event
```

Run it from the app root; set `EXPO_NONINTERACTIVE=1` in scripts (non-interactive mode also starts on
CI or without a TTY, filling unstated values with defaults and printing them as warnings). Local
modules use the template version that matches the app's Expo SDK. On SDK 57 it writes (verified):

```
modules/time-change/
  expo-module.config.json
  ios/TimeChange.podspec  ios/TimeChangeModule.swift
  android/build.gradle  android/src/main/AndroidManifest.xml
  android/src/main/java/expo/modules/timechange/TimeChangeModule.kt
  src/TimeChange.types.ts  src/TimeChangeModule.ts  src/TimeChangeModule.web.ts
  LICENSE
```

No `package.json` and no `index.ts` (the `--barrel` flag adds one). `--features` picks the sample code
(`Constant`, `Function`, `AsyncFunction`, `Event`, `View`, `ViewEvent`, `SharedObject`, or `all`);
`--package` sets the Android package (default `expo.modules.<lowercased name>`).

This skill's workflow then: delete `src/` (the binding moves to the adapter, decisions.md section 6),
split each native class into a thin definition and a plain helper (TimeChangeSystem.swift / .kt), and
fill the podspec's summary and the Gradle versions.

`npx create-expo-module@latest add-platform-support --platform android` adds a platform to an existing
module (it detects features from the existing definition, best effort).

## 2. expo-module.config.json

| Key | Meaning |
|---|---|
| `platforms` | `apple` (or `ios` / `macos` / `tvos`), `android`, `web`, `devtools` |
| `apple.modules` | Swift class names of the `Module` subclasses to register |
| `apple.appDelegateSubscribers` | Swift classes extending `ExpoAppDelegateSubscriber` |
| `android.modules` | full names (package + class) of the Kotlin `Module` subclasses |

Autolinking registers only the listed classes: a `Module` subclass missing from the list is never
reachable from JavaScript (`module-class`), and a listed class that does not exist breaks the build
of the generated provider. Android `Package` classes (lifecycle listeners) are not listed: autolinking
finds them in files ending in `Package.kt`/`Package.java`. After editing the config, run
`npx pod-install` (a prebuilt `ios/`) or a clean prebuild.

Prove the linking without building: `npx expo-modules-autolinking resolve --platform apple --json`
lists `{ "packageName": "time-change", "pods": [{ "podName": "TimeChange", ... }], "modules":
[{ "class": "TimeChangeModule" }] }`, and `--platform android` lists
`"classifier": "expo.modules.timechange.TimeChangeModule"` (verified with expo-modules-autolinking
57.0.13).

## 3. The definition, component by component

Swift (`public class TimeChangeModule: Module { public func definition() -> ModuleDefinition { ... } }`)
and Kotlin (`class TimeChangeModule : Module() { override fun definition() = ModuleDefinition { ... } }`)
take the same components:

| Component | What JavaScript sees | Notes |
|---|---|---|
| `Name("TimeChange")` | the name `requireOptionalNativeModule('TimeChange')` looks up | inferred from the class name when missing; always write it, identical on both platforms (`module-name`) |
| `Constant("PI") { ... }` | a property computed once, on first access | `Constants([...])` is deprecated |
| `Function("name") { (a: String) -> String in ... }` | a synchronous function | runs on the JavaScript thread and blocks it; up to 8 arguments |
| `AsyncFunction("name") { ... }` | a function returning a Promise | runs on a background queue by default; a last `Promise` argument resolves later; Kotlin `AsyncFunction("x") Coroutine { ... }` takes a suspend body |
| `Property("name") { ... }` / `.get { }.set { }` | a property on the module object | read-only with one closure |
| `Events("onTimeChange")` | event names `addListener` accepts | inside `View { }` they are view callbacks instead |
| `OnStartObserving("onTimeChange") { }` / `OnStopObserving(...)` | nothing; first listener added / last removed | the event-name form exists on both platforms in 57.0.20; the no-argument form covers all events |
| `OnCreate { }` / `OnDestroy { }` | nothing | use them instead of the class initializer and destructor |
| `View(SomeView.self) { Prop(...); Events(...) }` | a component via `requireNativeView` | Android views extend `ExpoView` |
| `Class(Thing.self) { Constructor { }; Property(...) }` | a JavaScript class (a shared object) | instances must be released (`release()` or `useReleasingSharedObject`) |

Keep the definition thin: each closure calls a plain function of a helper that imports no Expo type
(`TimeChangeSystem.swift`, `TimeChangeSystem.kt`). The helper then type-checks alone (`swiftc
-typecheck`, `kotlinc` against `android.jar`; testing-and-proof.md) and is where the platform logic is
read and reviewed.

## 4. Types across the boundary

Arguments and return values convert automatically: `String`, `Bool`, `Int`/`Double` (JavaScript
numbers), arrays, dictionaries/maps, `nil`/`null`, URLs, enums that conform to `Enumerable`, and
`Record` structs/classes (typed objects with `@Field` properties). Prefer a `Record` over a dictionary
for any object with known keys: the conversion validates the shape. On the TypeScript side mirror the
Record as a type in the binding (section 10). A JavaScript number is a double: 64-bit integers lose
precision above 2^53; send them as strings.

## 5. Threads and queues

- `Function`, `Property` and `Constant` bodies run on the JavaScript thread: only cheap,
  non-blocking reads (a time zone id, a cached value). Never I/O, never a lock that UI work can hold.
- `AsyncFunction` runs on a background queue by default. UI work needs `.runOnQueue(.main)` (Swift) or
  `.runOnQueue(Queues.MAIN)` (Kotlin) after the closure. UIKit off the main thread trips the Main
  Thread Checker in debug and corrupts state in release (`main-thread` reports UIKit names such as
  `UIApplication.shared` in a sync function or a default-queue async one).
- A View's `AsyncFunction` runs on the UI thread by default and receives the view first.

## 6. Events: Events, sendEvent, OnStartObserving

```swift
Events("onTimeChange")
OnStartObserving("onTimeChange") {
  self.observer.start { [weak self] reason in
    self?.sendEvent("onTimeChange", ["reason": reason.rawValue, "timeZoneId": ...])
  }
}
OnStopObserving("onTimeChange") { self.observer.stop() }
OnDestroy { self.observer.stop() }
```

```kotlin
Events("onTimeChange")
OnStartObserving("onTimeChange") {
  val context = appContext.reactContext ?: return@OnStartObserving
  receiver = TimeChangeReceiver.register(context) { reason -> sendEvent("onTimeChange", mapOf(...)) }
}
OnStopObserving("onTimeChange") { stopObserving() }
OnDestroy { stopObserving() }
```

- Start OS observation when the first JavaScript listener arrives and stop it when the last one
  leaves: no listener, no OS work, no battery. Stop it in `OnDestroy` too (a reload destroys modules).
  Every `OnStartObserving("e")` has an `OnStopObserving("e")` (or the unnamed form), and the Module
  has an `OnDestroy` (`observer-stop`): the helper's `stop()` is correct only if the Module calls it.
- Every add has its remove in the same file (`observer-release`): a NotificationCenter observer token
  removed with `removeObserver(token)`, a receiver unregistered with `unregisterReceiver`.
- `[weak self]` in Swift closures the observer keeps, so the observer never keeps the module alive.
- The JavaScript side releases with `subscription.remove()` (section 10); async-safety owns the effect
  cleanup rules for the hook that subscribes.

## 7. Errors

- Swift: throw a subclass of `Exception` (override `reason`; the code is derived from the class name, or
  pass `code:` to `Exception(name:description:code:)`). Kotlin: throw a `CodedException`; its code is
  inferred from the class name (`ReactContextLostException` style names become `ERR_REACT_CONTEXT_LOST`),
  or use the shared ones: `Exceptions.ReactContextLost()` (`ERR_REACT_CONTEXT_LOST`),
  `Exceptions.MissingActivity()`, `Exceptions.MissingPermissions(...)`.
- In JavaScript a thrown native error rejects the Promise (async) or throws (sync) with an `Error`
  that carries a string `code`. The adapter catches it with `attempt` / `attemptAsync` and maps the code
  into the port's failure (`{ kind: 'time-change-read-failed', code }`); error-handling-typed-results
  owns the Result shape.
- `appContext.reactContext` (Kotlin) is null while React restarts: treat null as a failure, never `!!`.

## 8. Lifecycle, AppDelegate subscribers, Android lifecycle listeners

- Module lifecycle: `OnCreate`, `OnDestroy`, `OnAppContextDestroys`; iOS `OnAppEntersForeground`,
  `OnAppEntersBackground`, `OnAppBecomesActive`; Android `OnActivityEntersForeground`,
  `OnActivityEntersBackground`, `OnActivityDestroys`, `OnActivityResult`, `OnNewIntent`,
  `OnUserLeavesActivity`.
- iOS app events (open URL, push token, background fetch): a `public class X: ExpoAppDelegateSubscriber`
  listed in `apple.appDelegateSubscribers`. Objective-C classes are not supported.
- Android activity and application events: a class implementing `expo.modules.core.interfaces.Package`
  in a file ending in `Package.kt`, returning `ReactActivityLifecycleListener`s or
  `ApplicationLifecycleListener`s. Autolinking finds it; it is not listed in the config.
- Both replace text edits of the generated AppDelegate and MainActivity, which a clean prebuild would
  delete (expo-prebuild-and-config-plugins).

## 9. Views and shared objects

A view: `View(TaskChartView.self) { Prop("tasks") { (view, tasks: [TaskRecord]) in ... }; Events("onSelect") }`,
where `TaskChartView` extends `ExpoView` (required on Android) and declares
`let onSelect = EventDispatcher()` (Swift) or `private val onSelect by EventDispatcher()` (Kotlin).
TypeScript: `requireNativeView<TaskChartProps>('TaskChart')` in an adapter (decisions.md section 9).

A shared object (`Class(...)` with a `SharedObject` subclass) gives JavaScript a handle to a native
object. Each instance holds native memory until released: create it in the adapter, release it in the
port's dispose path, and never hold one in a store.

## 10. The JavaScript side: binding, typing, listening

```ts
import { requireOptionalNativeModule } from 'expo';

export type TimeChangeBinding = {
  getTimeZoneId(): string;
  /** Android only. */
  isAutomaticTimeEnabledAsync?(): Promise<boolean>;
  addListener(
    eventName: 'onTimeChange',
    listener: (payload: NativeTimeChangePayload) => void,
  ): { remove(): void };
};

export function createNativeTimeChangeAdapter(
  native: TimeChangeBinding | null = requireOptionalNativeModule<TimeChangeBinding>('TimeChange'),
): TimeChangePort { ... }
```

- `requireOptionalNativeModule`, `requireNativeModule`, `requireNativeView`, `NativeModule`,
  `EventEmitter` and `SharedObject` are exported from `expo` (SDK 57 `expo/src/Expo.ts`); import them
  from `expo`, not from `expo-modules-core`.
- The binding type lists the native members by their native names, the events through
  `addListener(eventName: 'onX' | 'onY', ...)` (or `NativeModule<{ onX: ... }>`), and marks a member
  one platform lacks with `?`. check-native-modules reads exactly these forms.
- Every module object is an event emitter: `addListener(name, fn)` returns a subscription whose
  `remove()` releases it; the module's `OnStopObserving` runs when the last one goes.
- A web build: `requireOptionalNativeModule` returns null, so the port answers `unavailable`; no
  `*.web.ts` module file is needed. (web-support owns web behaviour.)

## 11. iOS and Android differences that bite

| Topic | iOS | Android |
|---|---|---|
| Rebuild after a native edit | `npx expo run:ios` (or `npx pod-install` + Xcode for a prebuilt `ios/`) | `npx expo run:android` (Gradle sync) |
| Context | none needed for most system APIs | `appContext.reactContext` (nullable), `appContext.currentActivity` |
| System events | NotificationCenter observers; keep the token, remove it | context-registered `BroadcastReceiver`; on API 33+ pass `RECEIVER_EXPORTED` for system broadcasts (Android's guide: a receiver for system or other apps' broadcasts is exported; a not-exported one misses broadcasts from privileged system senders) |
| A capability one platform lacks | the member is absent; the binding marks it `?` | present |
| Main thread | `.runOnQueue(.main)`; UIKit only there | `.runOnQueue(Queues.MAIN)`; views only there |
| Caches | `TimeZone.current` is cached per process: call `NSTimeZone.resetSystemTimeZone()` before reading after a change | `TimeZone.getDefault()` follows the system (the framework resets it on a zone change); not verified on a device here |

Device behaviour of the time-change template (notification and broadcast delivery, the zone after a
change) is documented from Apple's and Android's references and was not run on a device in this
skill's verification; the compile checks in testing-and-proof.md were.
