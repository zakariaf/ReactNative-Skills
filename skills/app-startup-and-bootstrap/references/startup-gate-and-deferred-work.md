# The startup gate and deferred work

What may make the first screen wait, for how long, and where everything else starts. Verified on
2026-10-10 against React Native 0.86.3 (`Libraries/Interaction/InteractionManager.js`), React 19.2.3
and the canonical `withTimeout` (async-safety).

## Contents

1. Three kinds of startup work
2. Why startup is synchronous by default
3. The gate: blocking tasks under one deadline
4. Choosing the deadline
5. Deferred work: where each kind starts
6. Fonts are embedded, never loaded at runtime
7. InteractionManager is a stub
8. Measuring cold start (hand-off)
9. Tests

## 1. Three kinds of startup work

| Kind | Examples | Where |
|---|---|---|
| **Synchronous, before the first frame** | open the database and migrate, settings, catalogs, stores, the language | AppRoot's `startApp`, in the `useState` initializer |
| **Blocking async** (the first screen is wrong without it, and no synchronous API exists) | the session restore (auth-and-secure-storage's `restore()`, an async keychain or keystore read, or an auth SDK's `getSession()`), a file only an async API reads; always non-interactive | `createStartupGate({ blocking: [task], deadlineMs })` |
| **Deferred** (the first screen is right without it) | consent refresh, entitlement re-check, OTA update check, connectivity, prefetch, analytics init, sound bank decode | the owning component or service, after the splash release |

The default answer for anything new is "deferred". A task earns a place in the gate only when the
first screen would show something false without it (for example the signed-out screen to a signed-in
person), and only when its value has no synchronous source.

Two session cases, and how they meet the gate (`expo-secure-store` 57.0.4, `build/SecureStore.d.ts`,
verified on 2026-10-10; re-verify: `grep -n "export declare function" node_modules/expo-secure-store/build/SecureStore.d.ts`):

- **The stored session.** The session's storage and its rules belong to auth-and-secure-storage: every
  secure-store call is async behind its `SecureStoragePort`, with the fresh-install wipe and the
  `unavailable` state for a locked keychain. Its restore is non-interactive, so it is a **blocking
  task** under the deadline (`{ name: 'session-restore', run: () => restoreSession() }`, returning a
  Result). When it misses, the session starts as unknown or unavailable and the session provider
  restores again (in the foreground), instead of the splash waiting longer. `expo-secure-store` also
  has a synchronous `getItem`, but auth-and-secure-storage's rule 1 forbids it for session tokens:
  it blocks the JavaScript thread and skips the port's checks.
- **Anything behind biometrics** (`requireAuthentication: true`, Face ID, Touch ID, Android
  `BiometricPrompt`, a device-credential prompt). The read shows a system prompt and waits for the
  person, for as long as they take. Under a held splash the gate's deadline (at most 3000 ms) expires
  while the prompt is still on screen; `withTimeout` aborts the signal, but `getItemAsync` takes no
  signal and cannot be cancelled, so the app opens as "session unknown" and the prompt's answer
  arrives later into a model that stopped listening. The synchronous `getItem` is worse: it blocks
  the JavaScript thread until the person answers. A biometric unlock is a **lock screen or route
  guard after the splash release**: the app opens on a locked screen (navigation-and-routing's
  protected group), the screen asks, and the answer unlocks it. A gate task never waits for a person.

## 2. Why startup is synchronous by default

- `expo-sqlite`'s `openDatabaseSync` and `expo-sqlite/kv-store`'s synchronous getters read a few rows
  in milliseconds; the first frame then has the real data, with no loading state to design, test and
  translate.
- An `await` on the startup path (in the root layout or the app root) splits startup into "before" and
  "after" with nothing on screen in between, and every later piece of startup code has to know which
  side it is on (`startup-await` fails `await`, `.then`, `.catch` and `.finally` there).
- A Promise that never settles keeps a held splash up forever. The gate is the one place async work
  meets the splash, and it always opens by its deadline.

## 3. The gate: blocking tasks under one deadline

`createStartupGate({ blocking, deadlineMs, errorLog })` (template `startup-gate.ts`):

- each task is `{ name, run: (signal) => Promise<Result<unknown, { kind }>> }`: a Result, because an
  expected failure (no stored session, an expired refresh token) is a value;
- the tasks run in parallel under one deadline through `withTimeout`, which aborts the task's signal
  when time runs out, so an abandoned read is cancelled instead of finishing and writing later;
- the gate **never rejects and never waits past the deadline**: a failure or a timeout becomes a
  `StartupMiss` (`misses()`), and the app opens anyway; a timeout and a throw (a bug: tasks return
  Results) are recorded in the error log with source `startup`;
- `start()` runs the tasks once however often it is called; `subscribe` and `isReady` are
  `useSyncExternalStore`'s pair, read by `useStartupReady`.

A miss is information for the first screen's model ("session unknown, ask again"), never a reason to
block longer. The template's app root passes `blocking: []`: storage and settings are synchronous and
fonts are embedded, so the gate is ready on creation.

## 4. Choosing the deadline

`deadlineMs` is a literal or a module constant (`const STARTUP_DEADLINE_MS = 2000;`) so the checker
can read it; `startup-deadline` fails a missing or unreadable value and anything over `maxBlockingMs`
(default 3000, contract key). Why 3000: people read a launch longer than a few seconds as broken,
Android's own launch guidance treats a cold start of 5 s or more as excessive, and the iOS watchdog ends
an app whose launch keeps the main thread busy for many seconds. The gate's wait is not main-thread
work, but the person cannot tell the difference. The template uses 2000 ms.

## 5. Deferred work: where each kind starts

Deferred work starts from the component or service that owns it, once `useStartupReady` returned true
(the app root renders nothing before that, so an effect in any screen already runs after the release):

| Work | Starts in | Owner skill |
|---|---|---|
| Consent refresh (UMP), ATT prompt | the consent service, after the first screen | admob-ads-and-consent |
| Entitlement re-check, purchase listener | the IAP service | in-app-purchases |
| OTA update check (`checkForUpdateAsync`) | the update service; never awaited before the first frame | ota-updates |
| Connectivity, query focus/online managers | `QueryProvider` while mounted | networking-and-server-state |
| Sound bank decode | `services.audio.load(...)` in `startApp` (it starts work and returns at once) | audio-and-haptics-feedback |
| Notification permission prompt | the feature that needs it, on the person's action | permissions-and-system-prompts |
| Notification channels and the reminder plan | the notification ports' sync hooks, after the first screen (channels at launch, never a prompt) | local-notifications, push-notifications |
| Crash reporter init | the adapter is created in `createDeviceServices` with no I/O; `Sentry.init` runs only when `useCrashReportingConsent` applies the saved choice after `useStartupReady` (inside `SettingsStoreProvider`, or in `AppRoot` with `isReady`), never in the composition root or the root layout | crash-reporting-and-observability |
| Analytics: screen views, flush | `useScreenViews(...)` in `AppStack`; the consent record is read on first use, after the first render; `analyticsFlusher(...)` joins the flushers `startApp` returns | analytics-and-consent |
| Lost picker result (Android), orphan media sweep | `importer.importPendingPick()` and `sweepMedia(...)` once the data layer opened and the splash is released; neither blocks the first frame | media-images-and-files |
| Background task registration | `reconcileBackgroundTasks` from a hook once startup is ready (`use-background-registration.ts`), never at import time | background-tasks |

An iOS background launch (a background task, a silent push) usually renders the root layout out of
sight: everything above runs, the migration and a direction restart included. A restart then cuts the
running job, which is safe only because jobs commit per step (background-tasks), and work that needs
the person (a prompt, a sheet) waits for the app to be active.

## 6. Fonts are embedded, never loaded at runtime

`useFonts` or `Font.loadAsync` (expo-font) at startup either holds the first frame for the files or
shows the system font first and swaps (a visible jump). The expo-font config plugin embeds the files
at build time, so they exist before the first frame on both platforms (`runtime-font-load` fails any
runtime load in app code). Font choice and the plugin entry are design-system-structure's.

## 7. InteractionManager is a stub

In React Native 0.86.3 `InteractionManager` is marked `@deprecated` and `runAfterInteractions`
schedules the task with `setImmediate`: it no longer waits for animations or interactions. Code that
"defers until after startup" with it runs on the next tick, in the middle of startup
(`interaction-manager`). Start deferred work from an effect after the splash release, or from the
animation's own completion callback.

## 8. Measuring cold start (hand-off)

Cold start (process start to the first screen with data) is measured and budgeted by
performance-budgets: React Native's startup marks begin at bundle load, so most of a cold start is
invisible to JS timing. This skill keeps the JS part short and ordered; that skill measures the whole.

## 9. Tests

- `startup-gate.test.ts`: ready at creation with no task; opens only after every task; an expected
  failure is a miss and is not recorded; a hanging task opens the gate at the deadline, aborts its
  signal and is recorded; a throwing task is recorded and the gate still opens; `start()` twice runs
  each task once; an unsubscribed listener is not called; a listener that throws is recorded and the
  others (the splash release) still hear the gate open.
- A new blocking task gets a test that drives the gate with the task's fake adapter (resolving,
  failing, hanging) and asserts the miss the first screen receives.
