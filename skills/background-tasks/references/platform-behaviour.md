# What iOS and Android actually do with background work

Every fact here says how it was established: **source** (read in the installed SDK 57 package, file
named), **docs** (the Expo SDK 57 page or the platform's documentation, not run here), **introspected**
(`npx expo config --type introspect` in the reference app), or **design default** (this library's
choice, with the reason). Nothing here was measured on a device by this library; the device proof in
[testing-and-device-proof.md](testing-and-device-proof.md) is how an app measures it. Verified on
2026-10-14 against `expo-background-task` 57.0.21 and `expo-task-manager` 57.0.21.

Re-verify the source facts in an installed app:

```sh
sed -n '1,200p' node_modules/expo-background-task/ios/BackgroundTaskScheduler.swift
sed -n '1,200p' node_modules/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt
sed -n '1,80p'  node_modules/expo-background-task/ios/BackgroundTaskAppDelegate.swift
grep -n "runTasksWithReason" -A30 node_modules/expo-task-manager/ios/EXTaskManager/EXTaskService.m
grep -n "tasks.get\|unregisterTaskAsync\|console.error" node_modules/expo-task-manager/src/TaskManager.ts
```

## Contents

1. One worker for every job
2. When a run happens
3. How long a run may last, and how it ends
4. What runs in the process (headless or not)
5. When runs stop for good
6. The interval
7. Availability: simulator, Expo Go, web
8. Side by side

## 1. One worker for every job

`expo-background-task` schedules **one** system worker per app, whatever the number of JavaScript
tasks (docs: "Multiple background tasks"; source: one `BGProcessingTaskRequest` with the identifier
`com.expo.modules.backgroundtask.processing` on iOS, one unique WorkManager work
`EXPO_BACKGROUND_WORKER` on Android). When the worker runs, it **starts every registered task of the
type at once** and reports done when the last one finishes: on Android `runTasks` calls
`executeTask` on each consumer inside one `map` and only then `awaitAll()`s the completions (source:
`BackgroundTaskScheduler.kt`); on iOS the task service starts every task and collects the results
afterwards (source: `EXTaskService.m` `runTasksWithReason`). So the jobs of one worker run
**concurrently, interleaved in one JS runtime** (each `await` lets another job continue).

Consequences the rules encode:

- The **interval is shared.** Each registration overwrites the stored interval; the last registered
  task sets it (docs and source). Rule 10: one interval constant for every job.
- **The jobs share one window, at the same time.** Five jobs with 20 s budgets do not each get their
  own 30 s; they all run inside the same window. Keep the sum of their budgets inside the window you
  can count on (section 3): conservative, because they overlap, and safe if a later version runs them
  one after another. Or merge them into one job with a bounded batch.
- **Single flight is per job name, not across jobs** (`runBackgroundJob` keeps one run per name). Two
  jobs that touch the same rows can interleave between any two `await`s. Make them coordinate through
  state transitions (each step reads the row's state and moves it on, so the second writer sees the
  first's result), or merge them into one job (job-design.md section 6).
- A crashed or hung job holds the worker until its budget ends; the runner's deadline (rule 5) frees
  it.

## 2. When a run happens

| | iOS (BGTaskScheduler, `BGProcessingTaskRequest`) | Android (WorkManager) |
|---|---|---|
| Earliest start | `earliestBeginDate = now + interval` (source) | one-time work with `setInitialDelay(interval)`, re-enqueued after each run (source) |
| Required conditions | `requiresNetworkConnectivity = true`, `requiresExternalPower = false` (source) | `NetworkType.CONNECTED` (source) |
| Who decides | the system, from battery, network and the user's usage of the app; "short intervals are often ignored", runs cluster in windows such as overnight (docs) | WorkManager plus the OS: Doze, App Standby Buckets, battery saver (Android docs) |
| App in foreground when due | the request runs only while the app is in the background (Apple docs) | the worker sees the app in the foreground and **re-schedules** itself in `min(60, interval)` minutes without running anything (source: `runTasks` checks `inForeground`) |
| After it ran | the expo app delegate re-submits the request (source) | the worker enqueues the next one-time request with `APPEND` (source) |

**Both platforms require a network connection** for every run, because the library sets that
constraint for all jobs (source). A purely local job (purging old rows) still only runs when the
device is online. Design default: if a job must run offline, it belongs on the foreground path.

**Never promise a time.** "Syncs every 15 minutes" is false on both platforms. Copy says "syncs in the
background when your phone allows it"; anything time-critical is a push message (push-notifications)
or a scheduled local notification (local-notifications), not a background task.

## 3. How long a run may last, and how it ends

- **iOS.** A processing task can be given minutes when the device is idle and charging, but the system
  may end it at any moment by calling the expiration handler (Apple docs). The expo handler marks the
  task failed and re-schedules (source). It also posts an `onTasksExpired` notification for JS, but in
  57.0.21 the module only forwards it when the notification carries a `url` the poster never sets
  (source: `BackgroundTaskAppDelegate.swift` posts `userInfo: [:]`, `BackgroundTaskModule.swift`
  guards on `userInfo?["url"]`), so `addExpirationListener` may never fire. The template subscribes
  anyway (it only stops runs early) and nothing may depend on it.
- **Android.** A WorkManager worker may run up to 10 minutes before the system stops it (Android docs).
  The process can still be frozen or killed sooner under memory pressure or by vendor battery
  managers (dontkillmyapp.com, quoted by the Expo docs).
- **Design default: 25 s per job** (`MAX_JOB_BUDGET_MS`). It fits inside the shortest window any of
  the platform documents promise for background execution (around 30 s), leaves time to commit and
  write the run log, and is what makes a job's behaviour the same on both platforms. A job that needs
  more does a bounded batch per run and returns `partial`; the next run continues.

A run ends in one of four ways: the job returns; the budget passes (the runner aborts the signal and
records `timed-out`); the system expiry arrives (`cancelled`, when it reaches JS); or the process dies
with no JavaScript running at all. The last one is why every step commits on its own (rule 6).

## 4. What runs in the process (headless or not)

- **Android, process not running:** the task service loads the bundle with Expo's
  `react-native-headless` app loader (source: `TaskService.java`, `AppLoaderProvider.getLoader(
  "react-native-headless", ...)`). No activity starts and no root component renders: the entry file's
  imports run, routes do not. That is why tasks are defined in a module the entry imports (rule 2).
- **Android, process alive in the background:** the run happens in the existing JS runtime, next to a
  mounted but stopped UI (source: task managers of non-headless contexts take precedence).
- **iOS:** the system launches (or resumes) the app in the background through the normal app delegate
  path; whether the root layout has rendered and created its services by the time the task fires is not
  guaranteed (not verified on a device by this library).
- **iOS background launch runs the app's own startup out of sight (source reading; not run on a
  device):** the app delegate path usually creates the React root, so the root layout mounts and
  `startApp` runs in the background too, the foreground migration included. That is the same
  "migration in the background" risk rule 8 guards against, reached through the app's own startup:
  migrations must be crash-safe per step (persistence-and-migrations), and expensive startup work
  should wait for the app to be active (app-startup-and-bootstrap's deferred work). A direction
  restart (rtl-and-direction) during a background run cuts the job, which is safe because jobs commit
  per step.
- **expo-task-manager drops undefined tasks.** When a task fires and no `defineTask` registered its
  name in this JS runtime, the event handler logs a warning, reports the task finished, and calls
  `unregisterTaskAsync(taskName)` (source: `TaskManager.ts`). One release that defines the task inside
  a component turns into a task that silently stops running for every user who updated.
- **A rejected executor is only `console.error`ed** (source), then reported finished with result
  `null`. Rule 4 routes every executor through `toTaskExecutor`, which never rejects.

Consequences: a job takes everything from `BackgroundDeps` created per run (rule 7), never from React
context, a store or the root layout's composition root; and on iOS a run may share the process (and
the database file) with a live UI, so writes stay short and single-flight (rule 6).

## 5. When runs stop for good

| Event | iOS | Android |
|---|---|---|
| User force-quits the app (swipe away) | no more background runs until the user opens the app again (docs) | removing from Recents usually does **not** stop work; some vendors treat it as a kill (docs) |
| Force stop (Settings > Apps > the app > Force stop) | (no counterpart: the force-quit row above) | the app's WorkManager jobs and alarms are cancelled and nothing runs until the user opens the app again, the Android counterpart of an iOS force-quit; at that launch the startup reconcile registers the jobs again (Android docs, not run here) |
| Device reboot | registrations restored at the next launch (docs) | WorkManager re-schedules after boot (docs) |
| App update | registrations persist (they are stored by the task manager and restored at launch) | WorkManager work persists across updates |
| Task renamed or removed in a new release | the old name stays scheduled; when it fires it is undefined and dropped (source) | same |
| Low Power Mode / Background App Refresh off | runs stop (Apple docs) | battery saver, restricted bucket: runs deferred or stopped (Android docs) |

`reconcileBackgroundTasks` (rule 10) removes names the build no longer defines and re-registers a
changed interval, so a rename never relies on the drop-when-undefined path.

## 6. The interval

- **Floor:** 15 minutes (docs; WorkManager's minimum). The library does not clamp a smaller value on
  Android 8+ (it passes it as an initial delay; source), so the checker and the reconcile reject it.
- **Defaults differ:** the docs say 12 hours; the native code uses 12 h on iOS
  (`intervalSeconds = 12 * 60 * 60`) and **24 h on Android** (`DEFAULT_INTERVAL_MINUTES = 60L * 24L`)
  (source). Always pass `minimumInterval` (rule 10).
- **A changed interval needs unregister then register:** `registerTaskAsync` returns early when the
  name is already registered (source: `BackgroundTask.ts`).
- **It is a minimum**, never a schedule (docs, both platforms).

Design default: `12 * 60` minutes. Shorter intervals cost battery and are mostly ignored on iOS; the
foreground path (rule 11) covers freshness when the user is looking.

## 7. Availability: simulator, Expo Go, web

| Where | `getStatusAsync()` | `registerTaskAsync()` |
|---|---|---|
| iOS simulator | `Restricted` (source: `supportsBackgroundTasks()` is false under `targetEnvironment(simulator)`) | logs a warning once and returns without registering (source) |
| iOS device without UIBackgroundModes `processing` | `Available` | **rejects** (`BackgroundTasksNotConfigured`, source) |
| Expo Go | `Restricted` (source: `isRunningInExpoGo()`) | warns; use a development build |
| Android emulator and device | always `Available` (source: WorkManager is always there) | registers |
| Web | `Restricted` (source) | not available |

The port maps this to `available | restricted`; the app shows "background sync is not available on
this device" for `restricted` and keeps its foreground path.

## 8. Side by side

| Concern | iOS | Android |
|---|---|---|
| Scheduler | BGTaskScheduler, one `BGProcessingTaskRequest` | WorkManager, one unique one-time work, re-enqueued |
| Config | Info.plist `UIBackgroundModes: processing` + `BGTaskSchedulerPermittedIdentifiers` (the expo-background-task plugin; introspected) | none (WorkManager's own manifest entries merge in) |
| Simulator / emulator | no background tasks at all | full behaviour; force a run with `adb -s <serial> shell cmd jobscheduler run -f` |
| Default interval | 12 h | 24 h |
| Runs while app is in the foreground | no | skipped and re-scheduled |
| Runs after force-quit | no | usually yes after a swipe from Recents (vendor-dependent); no after Settings > Force stop, until the next launch |
| Several jobs in one run | started together, results collected afterwards | started together (`map`, then `awaitAll`) |
| Process at run time | app launched or resumed in the background | headless loader when not running |
| Expiry signal to JS | `addExpirationListener` (may not fire in 57.0.21) | none (the worker is stopped by the OS) |
| Debug trigger | `triggerTaskWorkerForTestingAsync()` in a debug build on a device, or the LLDB simulate command | `adb` (the in-app trigger runs nothing while the app is in the foreground; source) |
