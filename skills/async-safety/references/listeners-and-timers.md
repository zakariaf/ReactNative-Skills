# Listeners and timers

Every subscription and every timer has an owner that releases it. This reference lists the
subscription APIs of React Native 0.86 and Expo SDK 57 with their release call, the traps (removed
statics, shared emitters, the polyfilled EventTarget), timers under the New Architecture, what iOS and
Android do to JS while the app is in the background, why covered screens keep running, and the one
legitimate exception: a listener that lives as long as the app. Read it before adding any listener,
interval, timeout or animation frame.

## Contents

1. The rule: kept and released by its creator
2. Subscription APIs and their release (verified table)
3. Traps: removed statics, shared emitters, the polyfilled EventTarget
4. Timers under the New Architecture
5. The app in the background (iOS and Android)
6. Covered screens keep running
7. App-lifetime listeners and timers
8. Where the release lives

## 1. The rule: kept and released by its creator

The value a subscription call returns is the only way to undo it. Keep it in a variable and release it
where the work ends: an effect cleanup, the function a `useSyncExternalStore` subscribe returns, a
service's `stop()`/`dispose()`, a `finally`. A dropped handle can never be released; a kept handle
nobody releases is the same leak, one line later. The same holds for timer ids.

A leaked listener keeps firing after its screen is gone, Fast Refresh adds another copy on every save
during development, and on Android a leaked `hardwareBackPress` handler that returns `true` swallows
every later back press. A leaked interval keeps waking the JS thread (battery) and keeps acting on
state nobody displays.

`subscription-released` fails a dropped handle (a bare statement), and a kept one that the file never
removes (`.remove()`, `.unsubscribe()`, `.cancel()`, `.stop()`, `.close()`, `.dispose()`,
`.release()`, `.disconnect()`, `.off()`), calls (an unsubscribe function), returns, or hands over
(a property, an argument, an array element). A handle released in a closure written above the
assignment counts (`const stop = () => { subscription?.remove(); };`). A listener added to an object
the file tears down (`ad.destroy()`, `.dispose()`, `.close()`) counts as released with it.
`timer-cleared` does the same for timer ids and their clear functions.

## 2. Subscription APIs and their release (verified table)

Verified on 2026-10-04 against the installed type declarations (React Native 0.86.3
`types_generated`, expo-notifications 57.0.21, expo-network 57.0.2, expo-modules-core's
`EventSubscription`), except the rows marked otherwise. Re-verify with
`grep -rn "addEventListener\|addListener" node_modules/react-native/types_generated/Libraries/<Module>`.

| Subscribe | Returns | Release | Listener's declared return |
|---|---|---|---|
| `AppState.addEventListener('change' \| 'memoryWarning' \| 'blur' \| 'focus', fn)` (`blur`/`focus`: Android only) | `EventSubscription` | `subscription.remove()` | `void` |
| `AccessibilityInfo.addEventListener('reduceMotionChanged' \| 'screenReaderChanged' \| ..., fn)` | `EventSubscription` | `.remove()` | `void` |
| `Keyboard.addListener('keyboardDidShow' \| ..., fn)` | `EventSubscription` | `.remove()` | `unknown` |
| `Linking.addEventListener('url', fn)` | `EventSubscription` | `.remove()` | `unknown` |
| `Dimensions.addEventListener('change', fn)` | `EventSubscription` | `.remove()` | `Function` |
| `BackHandler.addEventListener('hardwareBackPress', fn)` (Android) | `{ remove(): void }` | `.remove()` | `boolean \| undefined` |
| `Notifications.addNotificationReceivedListener(fn)`, `addNotificationResponseReceivedListener(fn)` (expo-notifications) | `EventSubscription` | `.remove()` | `void` |
| `addNetworkStateListener(fn)` (expo-network) | `EventSubscription` | `.remove()` | `void` |
| `Accelerometer.addListener(fn)` and the other expo-sensors (from Expo's docs; not installed in the reference app) | a subscription | `.remove()` | `void` |
| `navigation.addListener('focus' \| 'blur' \| 'beforeRemove', fn)` (React Navigation, under Expo Router) | an unsubscribe function | call it, or return it from the effect | |
| `store.subscribe(fn)` (Zustand vanilla store), `queryClient.getQueryCache().subscribe(fn)` | an unsubscribe function | call it | |
| `Location.watchPositionAsync(options, fn)` (expo-location; from Expo's docs, not installed in the reference app) | `Promise<LocationSubscription>` | `.remove()`, after it resolves (effects-and-races.md, section 5) | |
| `signal.addEventListener('abort', fn)`, WebSocket `addEventListener` | nothing (EventTarget) | `removeEventListener(type, fn)`, or `{ once: true }` | |

A listener whose declared return is `unknown` or `Function` accepts an async function without any lint
error (promises-and-handlers.md, section 2); `async-by-reference` reports a promise-returning function
passed to any of them.

## 3. Traps: removed statics, shared emitters, the polyfilled EventTarget

- **No `remove*Listener` statics.** `AppState.removeEventListener`, `Keyboard.removeListener`,
  `Dimensions.removeEventListener`, `Linking.removeEventListener`, `BackHandler.removeEventListener` and
  `AccessibilityInfo.removeEventListener` are gone from React Native 0.86 (not in its types); old
  answers that use them fail type-checking or throw. The subscription's `remove()` is the only way.
  expo-notifications 57 has no `removeNotificationSubscription` either.
- **`Keyboard.removeAllListeners(event)` and `DeviceEventEmitter.removeAllListeners(event)`** remove
  every listener for that event, including the ones navigation and keyboard libraries registered.
  `subscription-released` fails both; remove only your own subscription.
- **The polyfilled EventTarget ignores `{ signal }`.** `AbortSignal` on a device is event-target-shim
  5.0.1, which reads only `capture`, `passive` and `once` (verified in its source). A listener
  registered with `{ signal }` is never removed there, while it is removed in Jest (Node).
  `abort-signal` fails it.
- **A listener inside render** is added on every render and never removed; subscribe in an effect,
  in a `useSyncExternalStore` subscribe, or once at the composition root.

## 4. Timers under the New Architecture

React Native 0.86 runs only the New Architecture (bridgeless). In `Libraries/Core/setUpTimers.js`:

- `setTimeout`, `setInterval`, `requestAnimationFrame` and their clear functions are host functions
  installed from C++, on both platforms; ids are numbers. Type them as
  `ReturnType<typeof setTimeout>` so the root program (with Node types) and the app program agree.
- `setImmediate` is a shim over `queueMicrotask`: on a device it runs as a microtask, before any
  timer and before React gets to render, unlike Node (Jest), where it is a macrotask. Do not use
  `setImmediate` to "yield"; use `requestAnimationFrame` or `setTimeout(fn, 0)` (with a cleared id).
- `requestIdleCallback` / `cancelIdleCallback` exist (native idle callbacks).
- `InteractionManager.runAfterInteractions` is deprecated and, in 0.86.3, a stub that runs the task on
  the next `setImmediate` (a microtask): it no longer waits for animations or interactions. Its handle
  still has `cancel()`. New code uses `requestIdleCallback` or schedules after the animation's own
  completion callback.
- `setTimeout` always gets an explicit delay (typescript-and-lint-rules' `setTimeoutNoDelay`).
- No timers, promises or `await` inside worklets: the UI thread hands back to JS with `scheduleOnRN`
  (motion-and-animation, skia-canvas-rendering). A frame callback's clock is the frame timestamp.

`timer-cleared` fails an id that is dropped (a bare `setTimeout(...)` statement, the body of
`new Promise((resolve) => setTimeout(resolve, ms))`, a timer started from a `.then` arrow body) and
an id kept but never passed to its own clear function. Ids collected in an array (`timers.push(setTimeout(...))`)
pass when the file clears them (`for (const id of timers) clearTimeout(id)`).

## 5. The app in the background (iOS and Android)

Backgrounding does not unmount anything: every mounted screen, effect, listener and timer is still
there when the app returns. What changes is whether JS runs at all. From the platforms' documented
behaviour (not measured on a device by this library):

- **iOS** suspends the app shortly after it leaves the foreground (unless a background mode keeps it
  running). Timers do not fire while suspended; when the app returns, timers that came due fire at
  once, all together. An interval does not "catch up" one tick at a time.
- **Android** keeps the process running for a while after it leaves the foreground; timers keep firing
  until the system freezes or kills a cached app (Android 14 and later freeze cached apps quickly;
  Doze defers work further). JS can therefore act in the background on Android when it would not on
  iOS: polling, sounds, animations that nobody sees.
- **Both:** the process may be killed in the background without any JS running. Never rely on a timer,
  a `finally` or an unmount to persist data (persistence-and-migrations writes at the moment of change;
  background-tasks owns work that must run while the app is not in the foreground).

So: pause intervals and loops while the app is not active (`useIsAppActive()` from `src/hooks`, owned
by react-components-and-hooks), and compute elapsed time from the injected clock when the app returns
instead of counting ticks.

## 6. Covered screens keep running

A stack screen that another screen covers stays mounted, and so do inactive tabs. react-native-screens
4.26 does not freeze them by default (`ENABLE_FREEZE = false` in `src/core.ts`), and even a frozen
screen keeps its effects and timers (freezing pauses rendering, not JS). Their `useEffect`s keep
running: a polling interval on the Tasks list keeps fetching while the user edits a task three screens
deeper.

Work that only makes sense while the screen is visible runs in `useFocusEffect` (expo-router), which
cleans up on blur and starts again on focus; combine it with `useIsAppActive()` for the background
case. Server polling is not hand-rolled at all: it is `useQuery({ queryKey, queryFn, refetchInterval,
subscribed: isFocused })` with `const isFocused = useIsFocused()` (expo-router), never a `setInterval` in
`useFocusEffect` around a fetch. A covered screen's query observer keeps its `refetchInterval` running
until `subscribed` (or `enabled`) turns it off; the app-in-background half is TanStack's
`focusManager` (and `onlineManager`) wired to AppState and connectivity, which networking-and-server-state
sets up: the interval fetches only while `focusManager.isFocused()` unless `refetchIntervalInBackground`
is set (verified in `@tanstack/query-core` 5.104.0 `queryObserver.js`, and `subscribed` in
`@tanstack/react-query` 5.104.0 `useBaseQuery.js`, on 2026-10-10). `focus-scoped-work` fails a `useEffect` in a screen folder (`src/features`, `src/app`, or
`"asyncSafety": { "focusDirs": [...] }`) that runs an interval, a `watch*Async()` subscription or an
expo-sensors listener, when the app uses expo-router or React Navigation.

## 7. App-lifetime listeners and timers

Some listeners live exactly as long as the app: the composition root wires a connectivity adapter or a
store-to-SDK bridge once, and nothing ever needs to stop it. Some SDKs even punish stopping (expo-network
57 cancels its single native monitor when the last JS listener goes, and a cancelled monitor never
starts again, per networking-and-server-state's adapter notes). For those, say so on the line above:

```ts
// app-lifetime: one native listener for the app's life; expo-network cannot restart its monitor
addNetworkStateListener((state) => { ... });
```

`subscription-released` and `timer-cleared` accept a reasoned `// app-lifetime: <why>` (at least 10
characters) on the call's line or the three lines above it, only in `.ts` files outside the screen
folders: a component or a screen never lives as long as the app. Prefer keeping the handle and giving
the module a `stop()` anyway when a test needs to tear it down.

## 8. Where the release lives

| Created in | Released in |
|---|---|
| `useEffect` / `useLayoutEffect` | the cleanup it returns (react-components-and-hooks checks that it returns one) |
| `useFocusEffect` | the cleanup it returns (runs on blur) |
| the `subscribe` given to `useSyncExternalStore` | the function `subscribe` returns |
| a service or store created by the composition root | its `stop()`/`dispose()`, called by whoever created it |
| a function that "watches" (`watchSyncStatus(...)`) | the stop function it returns; the caller owns it |
| a promise-based wait or deadline | its `finally` (as in `withTimeout`, `delayOrAbort`) |

react-components-and-hooks' `effect-cleanup` checks that a subscribing effect returns a cleanup at all;
`subscription-released` checks that the handle is released wherever it was created. An effect with no
cleanup trips both; fix it once.
