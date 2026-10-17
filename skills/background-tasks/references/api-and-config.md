# API, configuration and the choice of mechanism

The SDK 57 surface this skill uses, the configuration an app needs, and when a background task is the
wrong tool. Verified on 2026-10-14 (`expo-background-task` 57.0.21, `expo-task-manager` 57.0.21, the
Expo SDK 57 pages `sdk/background-task` and `sdk/task-manager`). Re-verify:

```sh
npm view expo-background-task@sdk-57 version && npm view expo-task-manager@sdk-57 version
curl -sL https://docs.expo.dev/versions/v57.0.0/sdk/background-task/index.md | sed -n '1,120p'
grep -n "normalizeTaskResult" -A14 node_modules/expo-background-task/ios/BackgroundTaskConsumer.swift
grep -n "setTaskCompleted" node_modules/expo-background-task/ios/BackgroundTaskAppDelegate.swift
APP_VARIANT=production npx expo config --type introspect --json | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(c.ios.infoPlist.UIBackgroundModes, c.ios.infoPlist.BGTaskSchedulerPermittedIdentifiers)"
```

## Contents

1. Choose the mechanism first
2. Install
3. The config plugin (not applied on its own)
4. expo-background-task API
5. expo-task-manager API
6. Wiring into the architecture contract and ESLint
7. Privacy and store declarations
8. Moving off expo-background-fetch
9. When multi-package

## 1. Choose the mechanism first

A background task is **deferred, opportunistic** work. Pick by what the user needs:

| The user needs | Use | Owner |
|---|---|---|
| Data fresh when they open the app | the foreground path: refetch on focus, on app active, after a write | networking-and-server-state |
| Their offline changes to reach the server eventually | the outbox sync on the foreground path, **plus** a background job as an optimisation | networking-and-server-state + this skill |
| A reminder at a time | a scheduled local notification (the OS delivers it with no app code running) | local-notifications |
| To learn about a server event now | a push message (visible); data-only pushes are not reliable | push-notifications |
| Periodic housekeeping (purge old rows, refresh a cache) | a background job, mirrored on app start | this skill |
| A long upload or download | a background-capable transfer API (not a background task); out of scope here | media-images-and-files |
| Location while in the background | `expo-location` `startLocationUpdatesAsync` with a task (its own permission flow) | permissions-and-system-prompts |

If a feature is wrong when the background run never happens, it must not depend on one (rule 11).

## 2. Install

```sh
npx expo install expo-background-task      # brings expo-task-manager as its dependency
npx expo install expo-task-manager         # list it too: the registry imports it directly
```

Both are native modules: a new development build is needed (Expo Go reports `Restricted`). The SDK 57
module map pins `~57.0.21` for both. dependency-management's policy lists them already.

## 3. The config plugin (not applied on its own)

`expo-background-task`'s plugin adds, on iOS:

```xml
<key>UIBackgroundModes</key> <array><string>processing</string></array>
<key>BGTaskSchedulerPermittedIdentifiers</key> <array><string>com.expo.modules.backgroundtask.processing</string></array>
```

The Expo page says prebuild applies these "automatically". **In SDK 57 it does not:** the package is
not in `@expo/prebuild-config`'s auto-applied list, and introspecting the reference app showed
`UIBackgroundModes: ["fetch"]` and no identifier until `'expo-background-task'` was listed (introspected
2026-10-14; `fetch` comes from `expo-task-manager`'s plugin, which *is* auto-applied). Without
`processing`, `registerTaskAsync` rejects on an iOS device with `BackgroundTasksNotConfigured`
(source: `BackgroundTaskModule.swift`). So list it, next to `expo-task-manager`:

```ts
// app.config.ts (inside the plugins list)
// UIBackgroundModes fetch (prebuild applies expo-task-manager's plugin on its own anyway).
'expo-task-manager',
// UIBackgroundModes processing and the BGTaskScheduler identifier.
'expo-background-task',
```

Then regenerate the native snapshot (expo-prebuild-and-config-plugins' `contracts/native-config.json`)
and review the diff: it gains `processing` and the identifier. Android needs no entry: WorkManager's
library manifest merges its own components (and its boot receiver permission) at build time.

`fetch` without a background-fetch user: expo-task-manager's plugin adds it whatever the app uses, and
there is no option to drop it. App Review asks that background modes be used for their purpose; say in
the review notes that background processing syncs user data (privacy-and-store-declarations).

## 4. expo-background-task API

| Call | Behaviour in 57.0.21 (source unless marked) |
|---|---|
| `getStatusAsync()` | `Available` (2) or `Restricted` (1): restricted on the iOS simulator, in Expo Go and on web |
| `registerTaskAsync(name, { minimumInterval })` | throws if `name` is not defined; returns without registering when restricted (one warning) or when already registered; rejects on iOS without `processing` |
| `unregisterTaskAsync(name)` | no-op when not registered |
| `triggerTaskWorkerForTestingAsync()` | `__DEV__` only (resolves false otherwise). iOS: `_simulateLaunchForTaskWithIdentifier` on a device; Android: runs the worker, which does nothing while the app is in the foreground |
| `addExpirationListener(fn)` | iOS only; may never fire in 57.0.21 (platform-behaviour.md section 3) |
| `BackgroundTaskResult` | `Success` (1), `Failed` (2): the executor's return value |

The executor's return value: on iOS `Success` maps to `UIBackgroundFetchResult.newData`, `Failed` to
`failed`, any other number to `newData`, and a non-number (`null` after a rejection) to `noData`
(source: `BackgroundTaskConsumer.swift` `normalizeTaskResult`). The template's `TASK_RESULT` pins 1
and 2 in a test.

**In 57.0.21 neither scheduler acts on it.** iOS completes the `BGProcessingTask` with
`setTaskCompleted(success: true)` whatever the executors returned (source:
`BackgroundTaskAppDelegate.swift`; only the expiry handler passes `false`), and Android's worker
returns `Result.success()` unless `runTasks` itself throws (source: `BackgroundTaskWork.kt`). The
result feeds the task service's aggregate and may matter in a later version, so `toTaskExecutor` keeps
mapping it honestly; the evidence of how a run ended is the run log, never the system's view.

## 5. expo-task-manager API

| Call | Use in this skill |
|---|---|
| `defineTask(name, executor)` | only in `define-background-tasks.ts`, at module scope, executor from `toTaskExecutor` |
| `isTaskDefined(name)` | the registry test |
| `getRegisteredTasksAsync()` | the adapter's `scheduled()`: filtered to `taskType` `backgroundTask` (iOS consumer) and `expo-background-task` (Android consumer), so location or notification tasks are left alone |
| `isTaskRegisteredAsync`, `getTaskOptionsAsync` | not needed: `scheduled()` returns names and intervals |
| `unregisterAllTasksAsync()` | never: it also removes location and notification tasks other features own |

The executor receives `{ data, error, executionInfo }` (`TaskManagerTaskBody` in 57.0.21). `toTaskExecutor`
passes `data` to the job as `context.input` and `error` as `context.error`, and records the run under
the `background` trigger. For expo-background-task `data` is empty and `error` is null. A notification
task (push-notifications) receives the payload in `data`; a location task (`startLocationUpdatesAsync`)
receives `{ locations }` in `data`, and a `TaskManagerError` (`{ code, message }`) in `error` when the
system reports a failed event. The job validates `input` with valibot and turns an `error` into an
outcome (`failed` or `deferred` with a kebab-case reason), never ignores it. `executionInfo` is not
passed on (its `taskName` is the job's name).

## 6. Wiring into the architecture contract and ESLint

architecture-and-boundaries classifies every SDK. An app that adopts this skill adds, in
`contracts/architecture.json` (checked in the reference app with the templates applied: its
check-boundaries passes):

```json
{
  "vendorSdks": {
    "expo-background-task": "BackgroundTasksPort",
    "expo-task-manager": "BackgroundTasksPort (and the task registry)"
  },
  "vendorSdkFiles": {
    "expo-background-task": ["src/services/background-tasks/expo-background-tasks-adapter.ts"],
    "expo-task-manager": [
      "src/services/background-tasks/expo-background-tasks-adapter.ts",
      "src/services/background-tasks/define-background-tasks.ts"
    ]
  },
  "adapterFiles": ["src/services/background-tasks/define-background-tasks.ts"],
  "compositionRoot": [
    "index.ts",
    "src/services/background-tasks/define-background-tasks.ts",
    "src/services/background-tasks/background-environment.ts",
    "src/data/open-background-data.ts"
  ]
}
```

Why each entry: the registry imports the task manager (an SDK) and the adapter (so it counts as an
adapter and a composition root); the background environment creates adapters per run, outside the
app's `createDeviceServices()`, because a headless run never renders the root layout; the entry
imports the registry; the data layer's background open path (`examples/open-background-data.ts`,
only when a job needs the database) creates the SQLite error log adapter and the repositories for the
run, as `open-device-database.ts` does for the app. Add `vendor('expo-background-task', 'BackgroundTasksPort')` and
`vendor('expo-task-manager', 'BackgroundTasksPort')` to `VENDOR_SDK_PATHS` in `eslint.config.mjs` in
the same commit, with the registry exempted the way the ATT adapter is (typescript-and-lint-rules owns
the file). Tests read the SDK with `jest.requireActual` / `jest.requireMock`, never an `import`, so
check-boundaries' `vendor-sdk` stays green for them too.

**The data layer's background open path** (`examples/open-background-data.ts`, copied to
`src/data/open-background-data.ts` when a job needs the app database) sets the connection pragmas, so
persistence-and-migrations' checker sees statements outside a repository. It is open-path
infrastructure, so list it in `contracts/persistence.json`:

```json
{ "sqlAllowed": ["src/data/open-background-data.ts"] }
```

Without the entry, check-persistence fails it with `sql-outside-repository` (verified on the reference
app, 2026-10-16). The background environment itself imports only `openBackgroundData` and never holds
the driver, so it needs no entry.

`import-time-work`: the registry's `defineTask` loop is import-time work on purpose (it must run in a
headless launch); it creates no adapter, store or database, so architecture-and-boundaries' layout
check passes it as is.

## 7. Privacy and store declarations

A background job that talks to the server is network code: it goes through the ApiClient
(`src/api/`), which privacy-and-store-declarations' network audit already covers. Background
processing itself collects no data, but declare what the job sends (the outbox payloads are user
content) the same way the foreground sync is declared. The run log stores only job names, times, ends
and kebab-case reasons: no user data.

## 8. Moving off expo-background-fetch

`expo-background-fetch` is deprecated in SDK 57 ("not receiving patches and will be removed",
docs). Its tasks map one to one:

| expo-background-fetch | expo-background-task + this skill |
|---|---|
| `BackgroundFetch.registerTaskAsync(name, { minimumInterval: seconds })` | `port.register(name, minutes)` through `reconcileBackgroundTasks` (minutes, not seconds) |
| `stopOnTerminate`, `startOnBoot` | gone: the platforms decide (platform-behaviour.md section 5) |
| executor returning `BackgroundFetchResult.NewData` | job returning a `JobOutcome`; `toTaskExecutor` returns `BackgroundTaskResult` |
| `getStatusAsync()` → `Denied`/`Restricted`/`Available` | `port.availability()` → `restricted`/`available` |

Remove it and move over, in this order (the Expo CLI has no `uninstall` command; npm removes the
package):

```sh
npm uninstall expo-background-fetch
# drop 'expo-background-fetch' from the app config plugins if it is listed there
npx expo install expo-background-task expo-task-manager
# list 'expo-background-task' in the app config plugins (section 3), regenerate the native snapshot
```

Then a new native build (development build or EAS build): the old native module stays in an installed
binary until it is rebuilt. The checker's `no-background-fetch` fails until the package and its imports
are gone.

## 9. When multi-package

The task registry and the entry belong to the app package (`apps/<app>/index.ts`), never to a shared
package: definitions must run in the app's own bundle. Jobs may live in a shared package as plain
TypeScript (no React, no SDK), each with its test. Run the checker once per app:
`node ${CLAUDE_SKILL_DIR}/scripts/check-background-tasks.mjs apps/<app>` (its `package.json` `main`
names that app's entry).
