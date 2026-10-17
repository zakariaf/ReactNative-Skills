# Startup, the checkpoint, SQL tests and the kill test

When the database is opened (synchronously, once, after anything that can reload the JavaScript
runtime), what a read-only peek may do, the WAL checkpoint on background, how the real SQL is tested
on Node, and how the kill test proves the write path on an iOS simulator and an Android emulator.

## Contents

- The startup order
- The read-only peek
- Opening once, in the root layout
- The checkpoint on background
- Tests on node:sqlite
- The kill test
- Mid-session kills
- inspect-database: reading a device's database
- What has been verified, and what has not

## The startup order

Everything up to the first frame is synchronous; the native splash covers it. app-startup-and-bootstrap
owns the whole order; this is the persistence part of it.

| Step | What | Writes? |
|---|---|---|
| 1 | Intl polyfills, the global error net | no |
| 2 | Decisions that can reload the runtime: the saved language and its direction (rtl-and-direction), a pending update (ota-updates). They may peek. | no (the kv-store direction guard is its own small store) |
| 3 | `openDeviceDatabase(errorLog)`: version check, adoption check, pragmas, snapshot, migrations | the first write |
| 4 | The SQLite error log (memory log as fallback), repositories (and, in the appendix, `hydrateDocument`) over `database.driver`, all inside `openDeviceData`; `AppData` gets only the status | the document's planned writes |
| 5 | Stores created from what the repositories read | no |
| 6 | The first screen renders; it shows the outcome message if the session is in memory | |
| 7 | After the first frame, never awaited: entitlement re-check, sync, prefetch | through repositories |

Why nothing is written before step 3: module code runs again after a reload (`reloadAppAsync`, a
direction switch), so an earlier write happens twice, and a migration interrupted by a reload is a
migration the user saw fail.

## The read-only peek

```ts
// src/data/peek-database.ts
export function peekDatabase<T>(read: (reader: SqlReader) => T, fallback: T, errorLog): T
// SqlReader = Pick<SqlDriver, 'get' | 'all'>: no exec, no run, no transaction
```

A peek opens its own connection (`useNewConnection: true`), reads, and closes; any error (a first
launch with no tables yet, an unreadable file) is recorded in the session's memory log and returns the
fallback. No DDL, no pragma, no migration, no write. If the peeked value is stale (a damaged row the full open will restore later), the next cold
start corrects the decision. The document appendix's `peekCurrentDocument()` is a peek too. Copy a peek
file together with the reload decision that calls it: until then nothing imports it, and knip reports it
as an unused file.

## Opening once, in the root layout

With Expo Router the root layout (`src/app/_layout.tsx`) is the first component that renders. Open the
data layer lazily on its first render (`const [data] = useState(openOnce)`, where `openOnce` calls
`openDeviceData({ clock, errorLog })`), never at import time, never as `useState(openOnce())`, whose
argument React computes on every render and throws away, and never as `const data = openOnce()` in the
component or a hook body (the React Compiler may memoize that call today, but it promises nothing and
silently skips a component it cannot compile; `open-at-import` reports all three), call `useCheckpointOnBackground(data.database)` there once, and hand `data` down with
`<AppDataProvider>`; model hooks read `useAppData()`. `examples/root-layout.tsx` is that file, built only
from this skill's templates (the self-test runs the checker on it). With architecture-and-boundaries'
composition root, pass its clock and memory error log to `openDeviceData` instead.
With React Navigation (the fenced alternative), the same lines go in the component that renders the
`NavigationContainer`; set `rootComponent` in `contracts/persistence.json` to that file.

## The checkpoint on background

`useCheckpointOnBackground(database)` subscribes to `AppState` and calls `database.checkpoint()`
(`PRAGMA wal_checkpoint(TRUNCATE)`) on `'background'`, not on iOS's transient `'inactive'`. Android
reports `'background'` on `onHostPause`, when the activity pauses (React Native 0.86.3's
`AppStateModule.kt`), so also when a permission dialog or another activity comes on top; an extra
checkpoint is cheap and harmless. After the checkpoint the WAL file is empty (the source
app measured `-wal` going from 4 to 16 KB to 0 bytes on an iOS simulator), so a device backup taken
while the app is suspended copies one self-contained file. The checkpoint only folds what is already
committed; anything the app must save on background is saved first by its own handler.

## Tests on node:sqlite

All under the root `test/sqlite/` (Node types; Jest's `unit` project runs them under jest-expo):

| File | Proves |
|---|---|
| `node-sqlite-sql-driver.ts`, `temp-database-folder.ts`, `node-database-files.ts` | the driver over `DatabaseSync` (foreign keys off like the device), one throwaway folder per test, file listing for snapshot pruning |
| `sql-driver-contract.test.ts` | both drivers keep one contract: rows, commit, rollback, nesting refused, a failed COMMIT (shared file) |
| `migration-runner.test.ts` | the runner (shared file) |
| `app-database.test.ts` | pragmas, ready, snapshot naming, reuse and pruning, refusing to migrate without a snapshot, newer, unversioned and unreadable files untouched, baseline adoption, failed step in memory with the raw error recorded, `storage-full` for a step and a snapshot that hit `SQLITE_FULL`, the status without the driver, checkpoint |
| `to-storage-failure.test.ts` | the SQLite error mapper on real node:sqlite errors and the device message forms |
| `migration-fixtures.test.ts` | every frozen fixture: unchanged, upgrades to the fresh schema, rows consistent |
| `sqlite-task-repository.test.ts` | writes read back after reopening, typed failures for invalid input, a missing list or task and a full disk, an unexpected error recorded raw, the multi-statement delete, an unreadable row skipped and logged |
| `reset-data.test.ts` | a reset clears the user's tables and keeps protected ones; `AppData.resetAllData` returns a `StorageFailure` and rolls back whole |
| `sqlite-error-log-adapter.test.ts` | the ring buffer, the fallback before the table exists and inside another transaction, unknown areas skipped |
| `sqlite-document-store.test.ts` | (appendix) slots, restore, quarantine bound, rollback |

`node:sqlite` loads without a flag on Node 22.18 or newer and works inside jest-expo's environment
(verified on Node 26.4.0). Its errors come from another realm inside Jest (`instanceof Error` is
false), so assert on `error.message` with `toHaveProperty`, and read messages without `instanceof`.
The pure tests beside the code (`src/data/**/*.test.ts`) include fast-check properties: the checksum
vectors, the load plan over any two rows, the codec round trip, the Premium guard. Coverage for
`src/data/` is held at 95 % statements, lines and functions and 90 % branches by the canonical
`jest.config.js`; the device-only files (`expo-sqlite-sql-driver.ts`, `open-device-database.ts`,
`expo-file-system-database-files-adapter.ts`, `peek-database.ts`, `peek-current-document.ts`) carry
the `// device-only: covered by ...` line and are left out.

## The kill test

Jest proves the SQL; only killing the real app proves the whole write path. It needs a Release build
installed on a dedicated device that nobody else is using (ios-simulator-build, android-emulator-build).

```sh
# iOS: a throwaway simulator "<project>-kill-test" on the newest iOS runtime, deleted afterwards
node ${CLAUDE_SKILL_DIR}/scripts/kill-test.mjs --create --app <path/to/App.app> --bundle-id <id> --expect-version <N>
# iOS: an existing dedicated simulator
node ${CLAUDE_SKILL_DIR}/scripts/kill-test.mjs --udid <udid> --bundle-id <id> --expect-version <N>
# Android: a dedicated emulator, named by serial (start one: emulator -avd <project>-kill-test)
node ${CLAUDE_SKILL_DIR}/scripts/kill-test.mjs --serial emulator-5554 --package <id> --apk <app.apk> --expect-version <N>
```

Twelve rounds by default: launch, then kill after 80, 160, ... 960 ms while the open, migrations and
first writes run (`--kills`, `--step-ms`). iOS kills the launch pid with SIGKILL; Android uses
`am force-stop`, which SIGKILLs the process and also puts the package in the stopped state (no alarms or
jobs until the next launch); for data integrity that equals a low-memory kill. Each delay counts from
the moment the launch returns: on iOS `simctl launch` returns once the process runs; on Android the
script resolves the launcher activity (`cmd package resolve-activity --brief`, or `--activity
<package>/<activity>`) and launches with `am start -W`, which returns when the first frame is drawn and
prints the cold start (`TotalTime`), so a slow emulator cold start no longer eats the whole kill
window. Choose `--step-ms` so that kills x step covers launch to the end of the startup writes: about
80 ms on a simulator, 120 to 200 ms on an emulator or an older phone (time one launch with a log line
after `openAppDatabase`). After the last round the app is launched once more and left running
`--settle-ms` (default 5000), then stopped: it must still be running at the end (`relaunch`: the app
comes back up after the kills, no crash loop), and the inspection then judges a finished open and
migration, not whatever the longest kill left behind; raise `--settle-ms` when the first upgrade on a
slow device takes longer. Then the database (and
its `-wal`, `-shm`) is copied out and inspected: readable, at the expected `user_version`, WAL,
`integrity_check`, `foreign_key_check`, and with `--document --app-id <id>` both slots and an empty
quarantine (`--repo .` also decodes the slots with the app's own codec). On Android the copy needs a
debuggable build (run-as) or `--android-root` on an emulator image without Google Play. `--dry-run`
prints the plan and ends with exit 2, never `RESULT: PASS`. An agent's own `sleep` may be blocked;
the script waits with `Atomics.wait`.

Run it after any change to the open path, a migration, the write path of a repository, or the startup.
Without a build, the report says the kill test is still owed.

## Mid-session kills

An end-to-end flow (e2e-maestro) on the same named device: add a few tasks through the UI, kill the app
(iOS: `xcrun simctl terminate <udid> <bundle-id>`; Android: `adb -s <serial> shell am force-stop
<package>`), relaunch, assert every committed task is back, then run `inspect-database` on the device.
Pass: every inspection exits 0 and no launch shows a data message.

## inspect-database: reading a device's database

```sh
node ${CLAUDE_SKILL_DIR}/scripts/inspect-database.mjs <app.db | dump.sql> --expect-version <N> [--max-version <N>]
node ${CLAUDE_SKILL_DIR}/scripts/inspect-database.mjs --udid <udid> --bundle-id <id> --expect-version <N>
node ${CLAUDE_SKILL_DIR}/scripts/inspect-database.mjs --serial <serial> --package <id> --expect-version <N>
```

It always works on a copy (opening the app's file in place can checkpoint or lock it), prints the
facts it read, and fails on `open`, `user-version`, `newer-version`, `journal-mode`, `integrity`,
`foreign-keys`, and with `--document` on `no-document-table`, `slot-missing`, `checksum`, `json`,
`schema-version`, `newer-version`, `app-id`, `quarantine` (`--allow-quarantine` after a planned damage
test) and `decode` (`--deep --repo .`). `--db-name` is the contract's `databaseFile`.

## What has been verified, and what has not

- On 2026-10-03 (Node 26.4.0 with SQLite 3.53.2, expo-sqlite 57.0.3 source and types, Jest 29.7 with
  jest-expo 57.0.5, TypeScript 6.0.3): every template passes `tsc`, the canonical ESLint config,
  Prettier and its Jest tests in the reference Expo app; the v2 examples pass the same on top of them.
- Verified on node:sqlite: transactional `user_version`; `VACUUM INTO ?` with a bound path and its
  refusal inside a transaction or onto an existing file; the cascade-delete trap of a parent rebuild;
  `integrity_check` reporting a bypassed CHECK constraint and throwing `database disk image is
  malformed` on a page whose header is overwritten (inspect-database reports it as `integrity`);
  `file is not a database` on a text file; a failed COMMIT (deferred foreign key) leaving the
  transaction open; `cannot start a transaction within a transaction` on a nested BEGIN.
- Read in expo-sqlite 57.0.3's sources: the database directories, `withTransactionSync` (BEGIN inside
  its try, ROLLBACK unconditional), `isInTransactionSync`, `:memory:` support, `useNewConnection`,
  `databasePath`, no default foreign keys in its build flags. Read in expo-file-system 57.0.7's types:
  `Directory.list()`, `File.delete()`.
- Verified in the source app on an iOS simulator (Xcode 26.6, 2026-09-26): WAL plus FULL survived
  twelve SIGKILLs during startup writes, and the checkpoint emptied the WAL; with a saved language whose
  direction differs from the device's, exactly one write happened after the direction reload and none
  before it, which is why rule 10 opens on the first render (iOS only; not repeated on Android).
- On an Android 15 emulator (API 35, a dedicated AVD `rnskills-kill-test`, run twice on 2026-10-03):
  `cmd package resolve-activity --brief` printed the launcher component on its last line, `am start -W`
  printed `Status: ok` and `TotalTime`, and the kill rounds ran against a system app (cold starts of
  2.0 to 13.2 s, which is why the delays start after `am start -W`); the copy step then stopped with
  `run-as refused: ... package not an application`, as it should for a package that is not debuggable.
- **Not yet run in this library:** the kill test against a Release build on iOS or Android (no native
  builds in the verification run), its settle launch and `relaunch` check, `VACUUM INTO`, snapshot
  pruning and `storage-full` on a device, and the Android copy path (run-as and root access). `--dry-run`
  printed both plans, settle launch included. Run the kill test on both platforms before
  calling a data layer done.
