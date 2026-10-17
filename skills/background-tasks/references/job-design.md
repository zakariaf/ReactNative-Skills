# Designing a background job

How to write a job that is correct when it runs twice, when it is cut anywhere, when it never runs,
and when it overlaps the user opening the app. The template files implement the mechanics
(`background-job.ts`, `task-executor.ts`, `reconcile-background-tasks.ts`); this file is about the
job's own logic. The worked example is `examples/sync-outbox-job.ts` with its test.

## Contents

1. The contract
2. Idempotent: a second run changes nothing
3. Resumable: cut anywhere, finish later
4. Bounded: a batch per run, a budget per job
5. Outcomes and what they mean to the system
6. Single flight and the foreground path
7. Dependencies: the background environment
8. The database in a background run
9. Registration: reconcile, settings, renames
10. The run log
11. Battery, data and the user

## 1. The contract

```ts
export const syncOutboxJob = defineBackgroundJob<SyncOutboxDeps>({
  name: 'tasks.sync-outbox',          // <area>.<job>, kebab-case, one literal, never renamed lightly
  budgetMs: 20_000,                   // a literal, at most 25_000
  run: async ({ deps, input, error, signal, shouldStop }) => { ... return { kind: 'done', processed } },
});
```

- `deps`: ports and repositories, created per run (section 7).
- `input`: the task body's data (a notification task's payload, a location task's `{ locations }`),
  `undefined` for expo-background-task and on the foreground path. Validate it with valibot.
- `error`: the task body's error (a `TaskManagerError` when the system reports a failed location
  event), `null` otherwise. Turn it into an outcome with a kebab-case reason.
- `signal`: aborts when the budget runs out or the system ends the window; hand it to every call that
  takes one (the ApiClient, `withTimeout`, `delayOrAbort`).
- `shouldStop()`: ask it **before each step**; when true, return `partial` with what is done.
- The job never throws for an expected reason: offline, server down, schema behind are outcomes.
  A throw is a bug; the runner records it as `crashed` with the original error.

## 2. Idempotent: a second run changes nothing

A background run can repeat work: the window can end after the server applied a change but before the
local commit, a foreground run can start right after a background one, iOS can re-launch a task the
expiry handler re-scheduled. So:

- **Every effect outside the device carries an idempotency key** (the change id, a client-generated
  UUID stored with the row). The server applies a key once. networking-and-server-state's ApiClient
  passes `idempotencyKey`.
- **Every local effect is a state transition, not an increment:** `markSynced(id)` (set a flag),
  `deleteCompletedBefore(cutoff)` (a condition), never `count = count + 1` or "append to the log".
- **Read the work from storage each run**, never from a variable that survived from the last run.
- **Prove it:** `runJobTwice(job, deps)` in the job's test, asserting the second run's outcome
  (`processed: 0`) and that the external fake saw each key once (rule 6, `job-tested`).

**Poison items.** Work is read oldest first, so an item that can never succeed is first in line on
every run and blocks everything behind it (head-of-line blocking). Tell the two kinds of failure
apart:

- **Permanent** (the same request cannot succeed: a 4xx other than 408 and 429, a payload the schema
  rejects): move the item to a state the user resolves (`markRejected(id, status)`, never a delete)
  and go on with the next item. The outbox networking-and-server-state and persistence-and-migrations
  describe has `pendingChanges()`, `markSynced(id)` and an `attempts` column, no rejected state: this
  skill's example adds one (a `rejected_status` column and its forward-only migration, which
  persistence-and-migrations owns), and takes `pendingChanges(limit)` with a batch limit.
- **Retryable** (offline, 5xx, 408, 429, a busy database): leave it pending and end the run with
  `deferred` or `failed`; the next run retries it. Count attempts in the row when the app wants to
  give up after N.

`examples/sync-outbox-job.ts` (`isPermanentRejection`) and its test show both.

## 3. Resumable: cut anywhere, finish later

The process can die between any two instructions with no JavaScript running (iOS expiry, Android
freezing a cached app, a vendor battery manager). So:

- **Commit per step.** One change sent, then `markSynced` in its own transaction; never "send all, then
  mark all". A cut run leaves every finished step finished and every other step pending.
- **Never hold progress only in memory.** A cursor, a page token, a "last synced at" lives in storage,
  written in the same transaction as the step it describes.
- **Check `shouldStop()` before each step**, not only at the start: the budget is enforced by the
  runner, but only the job can stop cleanly between steps.
- **Prove it:** `runJobUntilAborted(job, deps, n)` stops the run after `n` checks; assert the state is
  consistent (finished items finished, the rest pending) and that a following `runJobOnce` finishes
  the rest.

The runner stops waiting at the budget and aborts the signal, but JavaScript cannot be preempted: a
job that never asks `shouldStop()` and ignores the signal keeps running after the runner reported
`timed-out`, and its late writes land whenever the process next runs. That is a bug the runner records
(`timed-out` goes to the error log); fix the job, never raise the budget.

## 4. Bounded: a batch per run, a budget per job

- Pick a batch that finishes in well under the budget on a slow network: 20 changes for a sync, a
  page of rows for a purge. Return `partial` when the batch was full; `done` when less was pending.
- The budget is per job, but the jobs of one worker start together and share one system window
  (platform-behaviour.md section 1). Keep the sum of the budgets of all registered jobs near the
  window you can count on, or merge small jobs.
- Never loop "until nothing is left" in a background run; that is what the next run (or the foreground
  path) is for.

## 5. Outcomes and what they mean to the system

| Outcome | When | Task result | Run log |
|---|---|---|---|
| `done` (processed) | nothing left | Success | `done` |
| `partial` (processed) | stopped at the batch size, the budget or a stop check | Success | `partial` |
| `deferred` (reason) | preconditions missing: offline, signed out, schema behind | Success | `deferred` |
| `failed` (reason) | an expected failure: server rejected, storage full | Failed | `failed` |
| runner: `timed-out` | the budget passed | Failed | `timed-out` + error log |
| runner: `cancelled` | the system expiry stopped the run | Failed | `cancelled` |
| runner: `crashed` | the job threw | Failed | `crashed` + error log (original error) |
| runner: `overlapping` | a run of the same job was going on | Success | `overlapping` |

The task result is what `toTaskExecutor` returns to the task manager. In 57.0.21 neither scheduler
acts on it: iOS completes the system task as successful whatever the executor returned, and Android's
worker reports success (api-and-config.md section 4). The mapping stays honest for the task service's
aggregate and later versions; how a run ended is read from the run log. Reasons are kebab-case ids (`server-rejected-409`), never messages or user data:
the run log is stored and may be exported.

## 6. Single flight and the foreground path

- `runBackgroundJob` lets one run of a job go at a time **per JS runtime**; a second call answers
  `overlapping` at once. That covers the user opening the app while a background run is going on (same
  process on iOS and on a live Android process).
- It does not cover two processes. On Android a headless run and an app process are not expected to
  coexist for the same app, but idempotency (section 2) is what makes even that safe.
- **It does not cover two different jobs.** The worker starts every job at once, and they interleave
  in one JS runtime (platform-behaviour.md section 1). Two jobs that write the same rows either move
  them through state transitions (a step reads the row's state and moves it on, so the second writer
  sees the first's result, never a stale copy) or become one job.
- **The foreground path runs the same job through the same runner** (rule 11): on app active
  (`useIsAppActive()` turning true), after the user's write, on pull to refresh. Background runs are an
  optimisation the system may never grant: a restricted device, Low Power Mode, an iOS user who
  force-quit the app, Android's restricted bucket. `examples/use-sync-outbox-on-foreground.ts` shows
  the hook; its environment comes from the app's composition root (the database is open there).
- The foreground call passes `{ trigger: 'foreground' }`: `runBackgroundJob(job, environment,
  { trigger: 'foreground' })`. Only `toTaskExecutor` passes `background`. The run log keeps the two
  apart (section 10), so the foreground path never hides whether the system ran the task.
- A hook that runs every job may import the job list and loop: `for (const job of BACKGROUND_JOBS)
  runBackgroundJob(job, environment, { trigger: 'foreground' })`. The checker counts that hook as each
  job's foreground path.

## 7. Dependencies: the background environment

`createBackgroundEnvironment()` (template) is the composition root of a background run: it creates the
clock, an error log, the run log and the job deps, **per run, inside the executor**. Never:

- React context, hooks or a Zustand store (an Android headless run has none; on iOS the store may hold
  a stale or not-yet-hydrated state). Read and write storage through repositories; the UI picks the
  change up on its next read or hydrate.
- The app's `createDeviceServices()` result (it lives in the root layout's state).
- Module-level singletons created at import (a reload or Fast Refresh re-runs modules;
  architecture-and-boundaries forbids import-time adapters).

**The error log of a background run is durable.** The run often happens in a process nobody looks at,
so an in-memory log would take a crash's cause with it. The template environment records into
`createKvBackgroundErrorLogAdapter` (a ring buffer of the newest 50 entries on kv-store under
`background-error-log.entries`, with the run's memory log as its fallback); when a job needs the app
database, `openBackgroundData` adds a SQLite error log over the run's connection, which writes to the
app's own `error_log` table and falls back to the kv one (`examples/background-environment.ts`). The
runner puts the thrown value's message into the recorded message (`background job <name> threw:
<message>`), because error logs keep messages only. The debug screen reads both: the kv entries with
`createKvBackgroundErrorLogAdapter(...).entries()` and the app's error log as usual.

## 8. The database in a background run

- **Through the data layer only.** persistence-and-migrations keeps the `SqlDriver` in `src/data/`, so
  the background open path lives there too: `examples/open-background-data.ts`
  (`src/data/open-background-data.ts`) opens the connection, checks the version, sets the pragmas and
  returns `{ outbox, errorLog, close }` (repositories, never the driver), or `null`. The environment
  calls it and closes it in `dispose` (`examples/background-environment.ts`). List the file in
  `contracts/persistence.json` `sqlAllowed` (api-and-config.md section 6): it is open-path
  infrastructure.
- **Never migrate.** A migration in a background run can be cut mid-step, can race the foreground
  start on iOS (two connections, one migrating), and fails where nobody sees it. Open the database only
  when `readUserVersion(driver) === LATEST_DB_VERSION`; otherwise the job returns
  `{ kind: 'deferred', reason: 'schema-behind' }` and the next foreground start migrates. The checker's
  `job-no-migrate` fails `migrateDatabase`, `openAppDatabase`, `openDeviceDatabase` and
  `openDeviceData` in background code.
- **Its own connection** (`createExpoSqliteSqlDriver(APP_DB_FILE, { useNewConnection: true })`). On
  iOS and in a live Android process the app's main connection may be open in the same runtime;
  without a new connection the two share one, and closing the background one in `dispose` would close
  the app's.
- **Set the connection pragmas** (`APP_DB_PRAGMAS`: `foreign_keys`, `synchronous`) on the background
  connection: they belong to the connection, not the file (persistence-and-migrations).
- **Two connections in WAL mode** are fine for readers; a writer can meet `SQLITE_BUSY` while the
  foreground holds a write transaction (not measured here). Keep each background transaction to one
  step, and map a busy error to `deferred`.
- **Close the connection when the run ends**: the environment that opened it for the run closes it in
  `dispose` (`JobEnvironment.dispose`). `toTaskExecutor` calls `dispose` after every run, also after a
  crash, a timeout or an overlap, and records a failing `dispose` in the error log without changing
  the task result. Without it, repeated runs in a warm process (an iOS resume, a live Android process)
  leak connections to the app database. `runBackgroundJob` never calls `dispose`: on the foreground
  path the environment holds the app's own long-lived services.

## 9. Registration: reconcile, settings, renames

- Register **after startup**, never at import time and never in the registry file: registration is a
  native call that can fail, and it must not delay the first frame. `reconcileBackgroundTasks` (from
  a hook the root calls once the startup gate opened; `examples/use-background-registration.ts`) does
  the whole job: on a restricted device it changes nothing and reports `restricted`; otherwise it
  unregisters names the build no longer defines (renamed or removed jobs, an older app version's
  names), re-registers a changed interval, registers what is missing.
- **A user setting** ("Sync in the background", settings-and-preferences owns the store) feeds
  `isEnabled`; turning it off unregisters every job. Reconciles run one after another (the example
  hook chains each on the previous one): a quick off-and-on would otherwise interleave two runs' port
  calls, and the 'off' run could unregister after the 'on' run kept the schedule. The setting row shows `restricted` as "not
  available on this device", never a switch that does nothing.
- **Sign-out** (auth-and-secure-storage) calls the reconcile with `isEnabled: false` before clearing
  data, so no job runs for a signed-out account.
- **Renaming a job** is a new name: the reconcile removes the old one on the first start of the new
  version. Until that start, the old name may fire once, find no definition and be dropped by the task
  manager (harmless, but it woke the app for nothing).

## 10. The run log

`BackgroundRunLogPort` keeps the newest record per job **and trigger** in `expo-sqlite/kv-store`
(key `background-run-log.<trigger>.<name>`), apart from the app database (so it works in a headless
run and needs no migration). Each record carries `trigger`: `background` (the system's task executor)
or `foreground` (the app's own call). Without the split, the foreground run that starts when the
developer opens the app to read the log would overwrite the background record it was meant to show.
A debug screen (debug-menu-and-test-hooks) shows `lastRun(name, 'background')` for each job, and the
`foreground` record beside it; a support export may include both. The background record is the device
proof's evidence (testing-and-device-proof.md section 5): "did the system run it, when, how did it
end".

## 11. Battery, data and the user

- Background work costs battery and data the user did not ask for at that moment. Keep the interval at
  12 hours unless a measured need says otherwise, batch small, and send only what changed.
- The system punishes apps that overrun (iOS lowers their priority; Android moves them to stricter
  standby buckets). A job that finishes quickly keeps getting runs.
- Never show a notification "to keep the app alive"; Android foreground services are not background
  tasks and need a declared type and a visible reason (out of scope here).
