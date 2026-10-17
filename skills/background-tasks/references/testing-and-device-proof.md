# Testing background work: Jest first, then the device

Jest proves the logic (idempotent, resumable, budgets, mapping, reconcile). Only a device proves that
the system runs the task, that it is defined in a headless launch, and that the configuration is
right. Both are part of the definition of done for a new job.

## Contents

1. What each layer proves
2. Jest recipes
3. Android emulator proof (named device)
4. iOS device proof
5. Reading the result: the run log
6. What cannot be automated

## 1. What each layer proves

| Claim | Proved by |
|---|---|
| The job is idempotent | `runJobTwice` in the job's test |
| A cut run leaves consistent state and the next run finishes | `runJobUntilAborted` + `runJobOnce` in the job's test |
| The runner applies the budget, single flight, crash recording, run log | `background-job.test.ts` (template) |
| Executors never reject, map results, record `background` runs and dispose the environment | `task-executor.test.ts` (template) |
| A foreground run never overwrites the background record | `kv-background-run-log-adapter.test.ts` (template) |
| A crashed background run leaves its cause readable from another process | `kv-background-error-log-adapter.test.ts` (template) |
| The registration hook reconciles on start and on a setting change; the foreground hook runs on app active and never overlaps | the hooks' tests (`examples/use-background-registration.test.ts`, `examples/use-sync-outbox-on-foreground.test.ts`) |
| Every job of the build is defined at import | `define-background-tasks.test.ts` (template) |
| Orphans removed, intervals changed, restricted devices left alone | `reconcile-background-tasks.test.ts` (template) |
| Definitions, names, budgets, config, entry reachability | `check-background-tasks.mjs` |
| The OS runs the task, headless, with the real config | the device proof (sections 3 and 4) |

## 2. Jest recipes

**A job.** Fakes for its deps (an in-memory outbox, a fake sender that records idempotency keys), then
the kit from `test/background/job-test-kit.ts`:

```ts
it('sends every pending change once, and a second run changes nothing', async () => {
  const app = harness(['c1', 'c2', 'c3']);
  const outcomes = await runJobTwice(syncOutboxJob, app.deps);
  expect(outcomes).toStrictEqual([{ kind: 'done', processed: 3 }, { kind: 'done', processed: 0 }]);
  expect(app.requests()).toBe(3);
});

it('keeps every finished change finished when stopped mid-run', async () => {
  const app = harness(['c1', 'c2', 'c3']);
  const stopped = await runJobUntilAborted(syncOutboxJob, app.deps, 1);
  expect([stopped.outcome, stopped.sawStop]).toStrictEqual([{ kind: 'partial', processed: 1 }, true]);
  expect(app.pending()).toStrictEqual(['c2', 'c3']);
});
```

Add the cases the job's own failure modes need: the window ending between the external call and the
local commit (the key is applied once), the schema behind (`deferred`, nothing touched), offline
(`deferred`), a rejection (`failed` with a kebab-case reason). `examples/sync-outbox-job.test.ts` has
all four.

**The runner's budget** uses fake timers (`// allow-fake-timers:` marker on line 2, because the budget
is a `withTimeout` deadline): `jest.advanceTimersByTimeAsync(budgetMs)`, then assert `timed-out`, the
aborted signal and `jest.getTimerCount()` 0. Never fake timers in a job's test: jobs take no timers.

**The SDK** is read in tests with `jest.requireMock` / `jest.requireActual`, never imported (a test
import of a vendor SDK fails architecture-and-boundaries' `vendor-sdk`). The adapter test replaces
`getStatusAsync`, `registerTaskAsync`, `unregisterTaskAsync`, `addExpirationListener` and
`triggerTaskWorkerForTestingAsync` and keeps the real enums. jest-expo's default automock answers
`undefined` from every native call and `getStatusAsync` reports `Restricted` (it believes it runs in
Expo Go), so a test that forgets the mock sees "restricted" instead of failing loudly.

**Mock counts at import:** the Jest config clears mocks before each test (`clearMocks: true`), so a
call made while the registry module loads is read into a constant right after the imports
(`define-background-tasks.test.ts`).

**A payload job** (a notification or location task) passes the task body to the kit:
`runJobOnce(job, deps, { input, error })`, `runJobTwice(job, deps, { input })` and
`runJobUntilAborted(job, deps, { stopAfterChecks: 1, input })`, so the cut path runs with real input.
Add a case for an `error` from the system (a location task's `TaskManagerError`): the outcome is
`failed` or `deferred` with a kebab-case reason.

**Fakes:** `createFakeBackgroundTasks()` (schedule map, call log, availability, failing names) and
`createFakeBackgroundRunLog()` go into `createTestServices()` when a model or hook needs them.

**The hooks.** The registration hook and the foreground hook are the parts most likely to regress (a
setting change that no longer unregisters, a foreground run that stops happening), so each has a
test beside it. `renderHook` with the fake port: assert the schedule after mount, `rerender` with the
setting off and assert every job unregistered, `restricted` and a failing registration reach the
return value (`examples/use-background-registration.test.ts`). For the foreground hook, replace
`useIsAppActive` with `jest.mock('@/hooks/use-is-app-active', ...)`, give the job a sender whose
request stays open, and assert a `foreground done` record on active, nothing while inactive, and
`foreground overlapping` while a background run of the same job is going on
(`examples/use-sync-outbox-on-foreground.test.ts`).

## 3. Android emulator proof (named device)

Background tasks work on the emulator. Never use a booted or shared device: create one for this
purpose and name every command (android-emulator-build owns the build lane).

```sh
# A development build of the app installed on a named AVD, e.g. <project>-background (android-emulator-build).
SERIAL=emulator-5580                      # the serial of the emulator you started with -port 5580
PKG=com.example.tasks.dev                 # the variant's application id

# 1. Open the app once so the startup reconcile registers the jobs, then send it to the background.
adb -s $SERIAL shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
adb -s $SERIAL shell input keyevent KEYCODE_HOME

# 2. Find the WorkManager job (docs: "Inspecting background tasks").
adb -s $SERIAL shell dumpsys jobscheduler | grep -A 40 -m 1 -E "JOB #.* $PKG"
#    JOB #u0a453/275: ... androidx.work.impl.background.systemjob.SystemJobService
#    Required constraints: TIMING_DELAY CONNECTIVITY ...

# 3. Force it now (the app must be in the background: the worker skips runs while it is in front).
adb -s $SERIAL shell cmd jobscheduler run -f $PKG 275

# 4. Watch it run.
adb -s $SERIAL logcat -d | grep -E "BackgroundTaskScheduler|BackgroundTaskWork|TaskService|ReactNativeJS" | tail -40
```

Then read the run log's `background` records (section 5). To prove the headless path, kill the process
first (`adb -s $SERIAL shell am kill $PKG` after pressing Home) and force the job again: a new
`background` record must appear, which proves the registry is reachable from the entry.

Constraints from the Android docs (not run here) for harder cases: `adb -s $SERIAL shell dumpsys
deviceidle force-idle` (Doze), `adb -s $SERIAL shell am set-standby-bucket $PKG rare` (a rarely used
app), and `adb -s $SERIAL shell cmd connectivity airplane-mode enable` (the network constraint keeps
the job waiting).

## 4. iOS device proof

The iOS simulator has no BGTaskScheduler: the status is `Restricted` and nothing registers. Use a
physical device with a development build (signing and installing it is ios-release-testflight's and
the developer's job; never automate an upload).

1. Open the app (the reconcile registers), then press Home.
2. Trigger the run, either way:
   - from the debug menu (debug-menu-and-test-hooks): a test-only action calling
     `triggerBackgroundRunForTesting()`; or
   - from Xcode, with the app paused in the debugger (Apple's documented technique):
     `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.expo.modules.backgroundtask.processing"]`,
     then continue.
3. To test the expiry path: `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateExpirationForTaskWithIdentifier:@"com.expo.modules.backgroundtask.processing"]`
   while a run is going on. In 57.0.21 expect the native side to mark the task failed and re-schedule
   while the JS listener may not fire (platform-behaviour.md section 3): the job must still leave
   consistent state.
4. The Xcode console line `No task request with identifier com.expo.modules.backgroundtask.processing
   has been scheduled` means the registration never happened: the plugin is missing from the app
   config, the build predates it, or the reconcile did not run (docs).

## 5. Reading the result: the run log

The run log is the evidence, and only its `background` records count. The run log keeps the newest
record per job **and trigger**: `toTaskExecutor` records the system's runs as `background`, the
foreground path records its own as `foreground`. That split matters here: bringing the app forward to
read the debug screen runs every job on the foreground path (rule 11), and that run is fresh, ends in
`done` and proves nothing about the system.

1. Note the time just before the trigger (the `adb` force in section 3, the debug action or LLDB in
   section 4).
2. Open the debug screen (debug-menu-and-test-hooks). It lists, for every job, `lastRun(name,
   'background')`: end, processed, reason, start and finish times; it may show the `foreground` record
   beside it, labelled as such.
3. The proof passes when each job's **background** record started after the noted time and ended in
   `done`, `partial` or `deferred` (with the reason you expected, such as `offline` in airplane mode).
   `crashed` or `timed-out` fails it; the debug screen's background error log shows why. The runner
   records the cause as `background job <name> threw: <message>` (or `... timed out`) into the run's
   error log, which is durable: the kv-store ring buffer (`createKvBackgroundErrorLogAdapter(...)
   .entries()`, key `background-error-log.entries`) in every run, and the app's `error_log` table when
   the run opened the database at the current schema (job-design.md section 7). A stack trace is not
   kept; reproduce the run locally with `runJobOnce` and the same deps, or hand it to the app's crash
   reporter (crash-reporting-and-observability).
   No background record, or one older than the trigger, fails it too: the task never fired, was not
   defined in the headless launch, or iOS rejected the registration (section 4, item 4). A
   `foreground` record never counts, however new.

A Maestro flow that reads the screen after an `adb` trigger asserts the same thing: the background row,
not the newest row.

## 6. What cannot be automated

- When the system decides to run a task on its own (hours, overnight). Do not write a test that waits
  for it; the forced runs above are the proof.
- Maestro flows can open the debug screen and read the run log after an `adb` trigger on Android
  (e2e-maestro), but there is no Maestro step that triggers BGTaskScheduler on iOS.
- Vendor battery managers (dontkillmyapp.com) and Low Power Mode behaviour: note them in the release
  checklist, test on one real device of the main vendor if the job matters.
