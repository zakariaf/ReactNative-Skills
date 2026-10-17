# Flushing on leaving the foreground

Startup restores state; the flush is its mirror image: buffered writes reach storage before the
operating system can end the process. Verified on 2026-10-10 by reading React Native 0.86.3
(`React/CoreModules/RCTAppState.mm`, `ReactAndroid/.../appstate/AppStateModule.kt`,
`Libraries/AppState/AppState.js`). Re-verify: `grep -n "inactive\|background" node_modules/react-native/React/CoreModules/RCTAppState.mm`.

## Contents

1. When does the app leave the foreground
2. What must flush, and what need not
3. One root hook, many flushers
4. Order: flush before checkpoint
5. Flushers are synchronous
6. Writing a flusher
7. Tests
8. Pitfalls

## 1. When does the app leave the foreground

| Event | iOS (`RCTAppState`) | Android (`AppStateModule`) |
|---|---|---|
| App switcher (iOS) / Recents (Android) | `active` -> `inactive` | `active` -> `background` (`onHostPause`: the activity is paused) |
| Control Center, a call banner, the Face ID sheet (iOS) / notification shade, an in-app dialog or overlay that leaves the activity resumed (Android) | `active` -> `inactive` | no `change` event; only `blur`, then `focus` (`appStateFocusChange` from `onWindowFocusChange`) |
| A runtime-permission dialog, or another app's translucent activity on top (Android) | (the iOS permission alert is `active` -> `inactive`) | `active` -> `background` (`onHostPause`: that dialog is its own activity and pauses the host), then `background` -> `active` when it closes |
| Home, switching apps | `inactive` -> `background` | `active` -> `background` (`onHostPause`) |
| Swipe-kill from the app switcher | `inactive`, then the process ends: **no `background` event** | `background` first (the app was paused), then the process ends |
| Low-memory kill while backgrounded | nothing (the app is suspended) | nothing |

So the one dependable moment is the transition **out of `active`** (to `inactive`, `background` or
`unknown`): that is when `isLeavingForeground(previous, next)` is true. Flushing only on
`background` loses an iOS swipe-kill from the app switcher.

Android's `background` therefore does not mean "the person left the app": a permission dialog sends
it too. The flush on that transition is harmless (it writes what is buffered), but code must not
treat Android `background` as leaving, for example by locking the app or ending a session on it.

Android's `blur` is not a flush trigger: the shade or a dialog leaves the process running and
resumed, and the `change` event that matters (`background` from `onHostPause`) still comes before
the app can be killed from Recents. Android facts verified by reading `AppStateModule.kt`
(`onHostPause` sets `background`, `onWindowFocusChange` sends `appStateFocusChange`) and
`AppState.js` (`blur`/`focus` are Android-only listeners).

## 2. What must flush, and what need not

- **Need not:** every write that commits synchronously when it happens: the repositories (one
  transaction per change), the settings store (reduce, persist, publish), the direction guard. This is
  the default, and it is why the template's flusher list is empty.
- **Must:** anything that holds a write back on purpose: a debounced draft (a text field saving 500 ms
  after the last key), a batched event queue, an in-memory run of a real-time game saved at save points,
  a play-time counter.

## 3. One root hook, many flushers

Features never subscribe to `AppState` to save (`lifecycle-write` fails an `AppState` listener that
calls `flush*`, `save*`, `persist*`, `write*` or `commit*` outside `lifecycleFiles`). They expose a
`Flusher` (`{ name, flush }`) and the app root passes every flusher to `useFlushOnBackground` once
(`flush-root`: called once, only in the app root, and a defined hook must be mounted). Why one place:
scattered listeners run in subscription order, which nobody controls, and a listener in a screen
disappears when the screen unmounts, which is exactly when its draft most needs saving.

Where the flushers come from: `startApp` creates the buffered writers (a draft buffer over the
repository) and returns them in `flushers`; a screen that edits a draft reads the buffer from
context and never owns the flush. Typical members: a draft buffer, analytics-and-consent's
`analyticsFlusher(services.analytics, data.errorLog)` (synchronous; it catches its own promise).
The canonical `app-root.tsx` returns an empty list until the app has one.

## 4. Order: flush before checkpoint

`AppState` calls its `change` listeners in the order they subscribed (one `NativeEventEmitter`
subscription each). `useFlushOnBackground` is called before `useCheckpointOnBackground`
(persistence-and-migrations), so on the shared `background` event the drafts land first and the WAL
checkpoint then folds a database that already holds them into the main file (`flush-root` fails the
reverse order).

## 5. Flushers are synchronous

After the event, iOS gives a backgrounding app a few seconds and may suspend the JS thread at any
moment; Android may kill a backgrounded process without notice. A flusher that awaits may never
resume. Flushers call the synchronous repository write (`expo-sqlite`'s sync API) and return. A
flusher that throws is recorded (source `storage`) and the others still run (`runFlushers`).

## 6. Writing a flusher

The shape (examples/task-draft-buffer.ts): a buffer keeps the latest draft and a debounce timer;
`flush()` clears the timer and writes the pending draft synchronously if there is one; the timer's own
callback calls the same `flush()`. The buffer returns its `Flusher`, `startApp` adds it to `flushers`.

## 7. Tests

- `background-flush.test.ts`: the transition table (`active` -> `inactive`/`background`/`unknown`
  flushes; `inactive` -> `background` does not flush twice; returning does not flush) and a throwing
  flusher being recorded while the rest still run.
- `use-flush-on-background.test.ts`: React Native's Jest `AppState` is inert, so the test captures
  the registered listener with `jest.spyOn(AppState, 'addEventListener')` and emits the iOS sequence
  (`inactive`, `background`: one flush), the Android one (`background`: one flush) and unmount
  (the subscription is removed).
- A buffered writer's own test: write, flush, read back from `node:sqlite` through the `SqlDriver`
  (persistence-and-migrations' recipe).
- On a device (by hand, once per release candidate): type into a draft, swipe the app away from the
  switcher on iOS and Android, relaunch: the draft is there.

## 8. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Draft lost after an iOS swipe-kill | flush only on `background` | flush on leaving `active` |
| Draft saved twice | flush on both `inactive` and `background` | `isLeavingForeground` flushes once per exit |
| Draft lost when the screen closes | the screen's own `AppState` listener unmounted | a root flusher |
| Database backup misses the last edit | checkpoint ran before the flush | flush hook first |
| `await` in a flusher never finishes | the process was suspended | synchronous writes |
