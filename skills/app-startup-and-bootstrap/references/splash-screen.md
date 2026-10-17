# Holding and releasing the native splash

Why the app holds the splash, exactly how `expo-splash-screen` and Expo Router decide when it goes, on
iOS and on Android, and how to hold and release it so the first frame after it is the real first
screen. Verified on 2026-10-10 by reading `expo-splash-screen` 57.0.9 (`build/SplashScreen.native.js`,
`ios/SplashScreenManager.swift`, `android/.../SplashScreenManager.kt`), `expo-router` 57.0.24
(`build/renderRootComponent.js`, `build/utils/splash.js`, `build/global-state/store.js`,
`build/views/Try.js`) and the SDK 57 splash-screen docs. Re-verify after an SDK bump:
`grep -rn "preventAutoHide\|maybeHide\|CONTENT_APPEARED\|ContentDidAppear" node_modules/expo-splash-screen node_modules/expo-router/build`.

## Contents

1. What hides the splash when nobody holds it
2. Why the app holds it
3. The hold: module scope, once, second import
4. The release: once, in an effect, below the gate
5. What a crash does to a held splash
6. iOS and Android details
7. Expo Go, development builds and release builds
8. The splash image and colours (hand-off)
9. Pitfalls
10. Tests

## 1. What hides the splash when nobody holds it

The JS API (`expo-splash-screen` 57.0.9, verified):

| Call | What it does |
|---|---|
| `preventAutoHideAsync(): Promise<boolean>` | sets the native `preventAutoHideCalled` flag; resolves at once; does nothing (resolves `undefined`) without the native module (web, Jest without a mock) |
| `hide(): void` | hides now (on iOS on the main queue; on Android it lets the next pre-draw pass); safe to call twice |
| `hideAsync(): Promise<void>` | calls `hide()`; kept "for backwards compatibility" (docs) |
| `setOptions({ duration, fade })` | fade-out duration (default 400 ms) and, on iOS, whether to cross-fade (default false) |

Who hides it otherwise:

1. **The native module**, when React Native reports that content appeared
   (`RCTContentDidAppearNotification` on iOS, the `CONTENT_APPEARED` React marker on Android), unless
   `preventAutoHideCalled` is set.
2. **Expo Router.** Its entry calls an internal hold in a `setTimeout` ("so the user has a chance to
   call it first"), and when the navigation container reports ready it calls an internal
   "maybe hide" on the next animation frame. The native side hides only when the app did not call
   `preventAutoHideAsync()` itself. So with Expo Router and no app hold, the splash goes as soon as the
   navigator is ready, whatever the root layout renders.

## 2. Why the app holds it

With no hold, the splash goes at "navigation ready". Three things can still be on screen at that
moment, and each is a visible defect:

- **A direction restart.** `DirectionGate` renders `DirectionRestart`, an empty screen, for the
  moment before the reload. Unheld, the person sees splash, empty frame, splash-like reload, app.
- **A blocking task.** AppRoot renders nothing while the startup gate waits (the session restore,
  which auth-and-secure-storage reads asynchronously, or a file only an async API reads). Unheld, the person sees an empty
  frame. A biometric prompt is never such a task: it waits for the person, so it belongs on a lock
  screen after the release (startup-gate-and-deferred-work.md, section 1).
- **A first frame without data.** Fixed by the synchronous open, but only a hold makes "the frame
  after the splash is the real screen" a guarantee instead of a timing accident.

The hold costs nothing when startup is synchronous: AppRoot is ready on its first render and releases
the splash in the first commit's effect, about when Expo Router would have.

## 3. The hold: module scope, once, second import

```ts
// src/features/root-navigator/hold-splash.ts (template)
import { preventAutoHideAsync } from 'expo-splash-screen';
import { appErrorNet } from '@/services/error-net/app-error-net';

preventAutoHideAsync().catch((error: unknown) => {
  appErrorNet.report({ source: 'unhandled-rejection', error, isFatal: false });
});
```

- **Module scope**, not a component or effect: the docs recommend calling it "in global scope without
  awaiting, rather than inside React components or hooks", and the native auto-hide fires on content
  appearing: an effect runs after content appeared, when iOS or Android may already have hidden it
  (`splash-hold`).
- **Imported for its side effect by the root layout, right after the error net** (`root-import-order`),
  so it runs before any module with bindings loads, and a failure reaches the net. A hold in a module
  nobody imports for its side effect may load late or never (`splash-hold`).
- **Once.** A second call is harmless natively but means two owners, and the next reader cannot tell
  which one the release answers (`splash-hold`).
- `.catch` to the error net, never `void` or an empty catch (error-handling-typed-results): the promise
  only rejects on a native bug, and that bug should be visible.
- The only allowed import-time work in the app: it opens nothing, writes nothing and is safe to run
  again after a reload (the new JS run holds the splash of the reloaded root view).

## 4. The release: once, in an effect, below the gate

```ts
// in AppRoot (template)
const isReady = useStartupReady(app.gate, hideSplash);   // hideSplash = expo-splash-screen's hide
if (!isReady) return null;                                // the held splash covers this frame
```

`useStartupReady` reads the gate through `useSyncExternalStore` and calls `releaseSplash()` in a
`useEffect` once `isReady` is true. The rules (`splash-release`):

- **In an effect, after the commit**, never in a render body (React may render without committing,
  and the frame under the splash would not be the committed one) and never at module scope (nothing is
  on screen yet).
- **Below the gate**, never in the component that renders `DirectionGate`: the root layout's effect
  also runs in a JS run that is about to restart, which would uncover the restart screen.
- **From one file.** The release is the app's single answer to "is the first screen ready"; two files
  releasing means the earlier one wins and the later one's wait is a lie.
- **Every hold has a release.** Expo Router leaves a held splash alone: a hold with no release keeps a
  release build on the splash forever (in development the dev menu still works, so this shows up first
  in TestFlight or an internal Play track).

## 5. What a crash does to a held splash

You do not need a second release for errors. Expo Router 57.0.24 wraps the global error handler the
first time its internal hold runs: an uncaught error calls `hide()` before the previous handler, and
its `Try` boundary (the root `ErrorBoundary`) hides the splash when it renders the fallback. A crash
while the splash is held therefore shows the crash fallback, not a frozen splash. A hang is the gate's
deadline's job (startup-gate reference).

## 6. iOS and Android details

| | iOS | Android |
|---|---|---|
| What is shown | the launch storyboard (`SplashScreen.storyboard` from the config plugin), reused as the root view's loading view | the Android 12+ system splash (`androidx.core.splashscreen`, `installSplashScreen()`), back-ported below 12 by the library |
| Kept on screen by | the loading view over `RCTSurfaceHostingProxyRootView` | a pre-draw listener that refuses to draw while held |
| Auto-hide signal | `RCTContentDidAppearNotification` | `ReactMarkerConstants.CONTENT_APPEARED` |
| `hide()` | removes the loading view on the main queue (cross-fade when `setOptions({ fade: true })`) | lets the next pre-draw pass; the exit animation fades over `duration` |
| Known quirk | `RCTRunningInAppExtension()` disables it (share extensions) | API 31-33: the library clears the exit listener on activity stop to avoid a `SurfaceControl` crash |

Android 12+ always shows the system splash with the app icon on the splash background colour for a
cold start; the image rules there come from the platform (an icon-sized centred image), which is why
the splash art is designed for both (icons-app-icon-and-splash).

## 7. Expo Go, development builds and release builds

From SDK 52 on, "Expo Go and development builds cannot fully replicate the splash screen experience" <!-- stack-pin-ignore -->
and "Expo Go will show your app icon instead of the splash screen", while "the splash screen on
development builds will not reflect all properties set in the config plugin" (SDK 57 docs, fetched
2026-10-10 from https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/). Judge the splash, the
hold and the release on a release build: `npx expo run:ios --configuration Release` /
`npx expo run:android --variant release` on a named simulator or emulator, or an internal
TestFlight/Play build (ios-simulator-build, android-emulator-build).

## 8. The splash image and colours (hand-off)

The `expo-splash-screen` config plugin in `app.config.ts` (`image`, `backgroundColor`, `dark`,
`imageWidth`, `resizeMode`, `android`, `ios`) draws the native splash at prebuild. Designing and
generating that art, per variant and for dark mode, is icons-app-icon-and-splash's job; this skill
only decides when the splash goes.

## 9. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Release build never leaves the splash | held, never released (or the release sits in a component that never mounts, such as behind a gate that never opens) | release through `useStartupReady`; the gate always opens by its deadline |
| An empty white frame between splash and app | no hold; or the release runs in the root layout above the gate | hold at module scope; release in AppRoot |
| Splash flashes off, then a direction reload | released above `DirectionGate` | release below it |
| Hold seems ignored on device | `preventAutoHideAsync()` in an effect or after an `await` | module scope, second import of the root layout |
| `hideAsync` result awaited in render, warnings about state updates | async release in render | `hide()` in an effect |
| Splash looks wrong in Expo Go | expected since SDK 52 | judge on a release build |
| `splash-hold` and `splash-release` fail after adding sign-in | the session code holds the splash in the root layout's initializer and calls `SplashScreen.hide()` from `AppStack` when the restore ends, with no deadline | keep the one hold in `hold-splash.ts` and the one release in AppRoot; make the restore a blocking gate task (startup-gate reference, section 1); once the gate opened nothing renders `null`: a restore that missed the deadline shows as `unavailable` (a "checking your session" route), never a blank frame |

## 10. Tests

- `hold-splash.test.ts` imports the module in `jest.isolateModules` with `expo-splash-screen` mocked:
  the hold runs once per module registry however often it is imported, and a rejection reaches the
  error net.
- `use-startup-ready.test.ts` renders the hook with a real gate and a `jest.fn()` release: released
  after the first commit when nothing blocks; not released while a task runs, released once after.
- On a device (by hand, once per release candidate): cold start a release build on a named simulator
  and emulator, with the saved language in each direction; the frame after the splash is the first
  screen, never empty, never the other direction.
