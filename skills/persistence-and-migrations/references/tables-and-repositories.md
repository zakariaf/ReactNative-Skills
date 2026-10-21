# Tables, repositories and the open path

How app data gets into the database and back: the SqlDriver port and its two drivers, opening the
file (version check, adoption, pragmas, snapshot, migrations, outcomes), repositories that return typed
Results, validation, transactions, resets and protected tables, the key-value and secrets boundary,
server-owned data in a networked app, the error log, where the file lives and how snapshots stay out of
backups, adopting this layer in an app that already ships a database, and what the checker reports
(and where its static reading stops). Every file named here is a template
in this skill. Verified on 2026-10-03 with expo-sqlite ~57.0.3, expo-file-system ~57.0.7, valibot
1.5.0 and Node 26.4.0 (re-verify: `npm view expo-sqlite@~57.0.3 version`, `npm view valibot version`,
`node -p "process.versions.sqlite"`).

## Contents

- Why SQLite tables through a port
- The SqlDriver port and its two drivers
- Opening the database: the order and why
- Outcomes and what the user sees
- Snapshots: names, reuse, pruning, backups
- Repositories return Results
- Validation at the boundary
- Transactions
- Resets and protected tables
- Small preferences and secrets
- Server-owned data (networked apps)
- The synced-store profile (opt-in)
- The error log table
- Where the file lives, and device backups
- Adopting in an existing app
- When multi-package
- Fenced alternatives: SQLiteProvider and Drizzle
- What check-persistence reports
- Limits of the static checks

## Why SQLite tables through a port

- **Tables and repositories are the default** because most apps hold lists that grow (tasks, notes,
  orders) and need queries, indexes and partial updates. A single JSON document rewrites everything
  on every change; it suits only small app state, and lives in the appendix (`save-document.md`).
- **expo-sqlite's synchronous API** lets the app open, migrate and read before the first frame, and
  a write has committed when the call returns, so the next line may navigate or publish to a store.
- **A tiny port (`SqlDriver`)** keeps the app's SQL testable for real: Jest runs the same statements
  on Node's built-in `node:sqlite` (no native module, no mock that agrees with every query).

## The SqlDriver port and its two drivers

```ts
// src/data/sql-driver.ts
export type SqlValue = string | number | null;          // no blobs, no booleans (store 0/1)
export type SqlRow = Readonly<Record<string, unknown>>;  // unknown until a row schema narrows it
export type SqlRunResult = { readonly changes: number; readonly lastInsertRowId: number };
export type SqlDriver = {
  readonly exec: (sql: string) => void;                                   // DDL, PRAGMAs, several statements
  readonly run: (sql: string, params: readonly SqlValue[]) => SqlRunResult;
  readonly get: (sql: string, params: readonly SqlValue[]) => SqlRow | null;
  readonly all: (sql: string, params: readonly SqlValue[]) => readonly SqlRow[];
  readonly transaction: (work: () => void) => void;   // BEGIN; work; COMMIT; ROLLBACK if still open + rethrow
};
export type ClosableSqlDriver = SqlDriver & { readonly path: string; readonly close: () => void };
export const NESTED_TRANSACTION_MESSAGE = 'SqlDriver.transaction cannot nest: ...';
```

- **Device:** `src/data/expo-sqlite-sql-driver.ts`. `createExpoSqliteSqlDriver(fileName, options)`
  opens with `openDatabaseSync` and wraps it with `wrapSyncSqliteDatabase(db)`: `execSync`, `runSync`,
  `getFirstSync`, `getAllSync`, `isInTransactionSync`, `closeSync`; `path` is `db.databasePath`.
  `useNewConnection: true` gives a peek its own connection, so closing it never closes the main one.
  It is the only file that imports `expo-sqlite` (the ESLint adapter list allows
  `src/data/**/*-sql-driver.ts`), and it is device-only for coverage.
- **Why transaction() is written out, not `withTransactionSync`:** in expo-sqlite 57.0.3 (read in
  its source) `withTransactionSync` puts BEGIN inside its try, so a nested call's failing BEGIN runs
  ROLLBACK on the OUTER transaction, which then commits half a change and throws `cannot rollback - no
  transaction is active`; and after a failed COMMIT that SQLite already rolled back, its ROLLBACK
  error replaces the real one (a full disk reads as "no transaction"). Both drivers therefore throw
  `NESTED_TRANSACTION_MESSAGE` before BEGIN when a transaction is open, and roll back only while one
  is still open.
- **Tests and Node tooling:** `test/sqlite/node-sqlite-sql-driver.ts` wraps `DatabaseSync` from
  `node:sqlite` (the root `test/` folder, because only the root TypeScript program has Node types).
  Rows have a null prototype (it copies them, or `toStrictEqual` fails), and **node:sqlite turns
  foreign keys on by default while the SQLite that expo-sqlite bundles leaves them off** (no
  `SQLITE_DEFAULT_FOREIGN_KEYS` in its build flags), so it opens with
  `enableForeignKeyConstraints: false` and only the app's own pragma turns them on. Node's SQLite is
  built without double-quoted string literals: write string literals in single quotes.
- **One contract, proven:** `test/sqlite/sql-driver-contract.test.ts` runs the same cases on both
  drivers (the device driver's own code over a node:sqlite stand-in for expo-sqlite's database):
  rows, commit, rollback, a refused nested transaction that rolls the outer change back whole, a
  failed COMMIT (a deferred foreign key) rethrown with no transaction left open, foreign keys off.

## Opening the database: the order and why

`openAppDatabase({ openDriver, files, fileName, migrations, errorLog, baseline? })` in
`src/data/app-database.ts`, called once by the startup through `openDeviceDatabase(errorLog)` (the
session's memory error log: the SQLite one needs this database first), which `openDeviceData`
wraps with the SQLite error log and the repositories:

| Step | What | Why |
|---|---|---|
| 1 | open `app.db` (expo-sqlite's directory) | |
| 2 | read `PRAGMA user_version` | reading changes nothing; a file that is not SQLite fails here (`file is not a database`) and becomes `unreadable` |
| 3 | newer than the migration list: close, run in memory, `newer-version` | an older build installed over a newer one (a TestFlight or internal-track downgrade) must not touch tables it does not know |
| 4 | read the file's own tables (`sqlite_master` without `sqlite_%`) | a file at user_version 0 that holds tables was written by something else: an earlier data layer, or a build before this one adopted the runner |
| 5 | version 0 with tables: adopt only when `isAdoptable`: their schema equals migrations 1..`BASELINE.version`, or one of `BASELINE.variants`; otherwise close, run in memory, `unversioned` | migration 1 would collide (`table tasks already exists`) or, with other names, the app would open "fresh" and silently ignore every existing row |
| 6 | `exec(APP_DB_PRAGMAS)`: `journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON` | after recognising the file, because setting the journal mode writes the file header; synchronous and foreign_keys belong to the connection, so every open sets them |
| 7 | at the latest version: done (`ready`) | no snapshot, no migration |
| 8 | the file holds tables: snapshot `VACUUM INTO '<path>.v<from>.bak'` (or reuse a healthy one) | a complete, consistent copy before any step runs (next section) |
| 9 | adopted file: stamp `user_version = BASELINE.version` | the baseline schema (or a variant the next step rebuilds) is already there; the steps above it run next |
| 10 | `migrateDatabase(driver, MIGRATIONS)` | each step and its version stamp in one transaction (`migrations-and-fixtures.md`) |
| 11 | success: prune old snapshots; a failed snapshot or step: close, record the raw error, run in memory, `migration-failed` (`storage-full` when SQLite reports a full disk) | the file keeps its last complete version; the next launch or build can retry |

Every raw error goes to `errorLog.record('storage', error)` before it becomes an outcome
(error-handling-typed-results: record the unexpected with the original error). WAL plus
`synchronous = FULL`: a committed transaction survives a kill and a power cut (verified on an iOS
simulator in the source app: twelve SIGKILLs during startup writes, every inspection healthy). STRICT
tables need SQLite 3.37 or newer: expo-sqlite 57.0.3 bundles 3.50.3, Node 26.4.0 ships 3.53.2.

## Outcomes and what the user sees

| Outcome | File | Session | Tell the user |
|---|---|---|---|
| `fresh` | created and migrated | on disk | nothing |
| `ready` | unchanged | on disk | nothing |
| `migrated` | upgraded; `<file>.v<from>.bak` beside it | on disk | nothing |
| `adopted` | an unversioned baseline stamped and upgraded; `<file>.v0.bak` beside it | on disk | nothing |
| `newer-version` | untouched | in memory | "This data was saved by a newer version of the app. Update the app to keep your changes." at every launch |
| `unversioned` | untouched | in memory | "Your data couldn't be opened by this version." (a developer error: the adoption step is missing, see below) |
| `migration-failed` | at its last complete version | in memory | "Your data couldn't be upgraded. Changes you make now won't be kept; an update will fix this." |
| `storage-full` | at its last complete version | in memory | "Your phone is out of space, so your data couldn't be upgraded. Free up some space and reopen the app; changes you make now won't be kept." |
| `unreadable` | untouched (keep it for support) | in memory | "Your data couldn't be opened." |

The copy is the app's (message keys in its catalogs, chosen by `kind`); the rule is that the
in-memory session says so once, on the first screen, and never pretends to save. `isPersistent:
false` is the flag to read. `checkpoint()` never throws: a failure is recorded.

`storage-full` exists because the snapshot needs room: `VACUUM INTO` writes a full copy, so it needs
about as much free space as the file, and a step that grows a table can hit the same wall. That
failure is the user's to fix, and "an update will fix this" would be untrue: the app would run in
memory on every launch until space is freed. The open path reads SQLite's code once
(`toStorageFailure(error).kind === 'full'`, on the raw error or the cause a wrapped snapshot error
keeps); `app-database.test.ts` proves both paths with a real `SQLITE_FULL` on node:sqlite (`PRAGMA
max_page_count`) and a snapshot that throws it. On a device the code is the same `SQLITE_FULL` (13);
not yet observed on a full phone.

The app sees only `DatabaseStatus` (`outcome`, `isPersistent`, `checkpoint`): `openDeviceData` puts
`databaseStatusOf(database)` in `AppData`, a new object without the driver, so no feature can reach
the `SqlDriver` through `useAppData()`, not even with a cast.

## Snapshots: names, reuse, pruning, backups

`src/data/database-snapshots.ts`:

- **One name per from-version:** `snapshotPathFor(path, from)` is `<path>.v<from>.bak`, never a time.
  A step that keeps failing used to write a new full-size copy on every launch (a probe of the
  earlier timestamped name: five launches, five copies).
- **Reuse:** `reuseSnapshot` keeps an existing `<file>.v<from>.bak` when it passes `quick_check` and
  opens at user_version `from`. That is safe in the retry loop: after a failed upgrade the session runs
  in memory, so the file has not changed since the copy. A copy that does not open at that version (a
  launch killed during `VACUUM INTO`) is deleted and taken again (`VACUUM INTO` refuses a target that
  exists and is not empty). After a manual restore from somewhere else, delete stale `.bak` files: reuse
  compares the version, not the content.
- **Pruning:** after a successful migration `pruneSnapshots` keeps the newest `SNAPSHOTS_KEPT` (2) and
  deletes the rest. It never throws (a failure is recorded). Files are listed and deleted through the
  `DatabaseFiles` port (`database-files.ts`): `createExpoFileSystemDatabaseFilesAdapter()` on a device
  (`expo-file-system-database-files-adapter.ts`, the only data file that imports expo-file-system; its
  synchronous `Directory.list()` and `File.delete()` were read in the 57 type declarations, not yet
  device-verified), `createNodeDatabaseFiles()` in tests. An adapter's file name is
  `<library>-<concern>-adapter.ts` with the package name as the library (architecture-and-boundaries),
  as `expo-sqlite-sql-driver.ts` names `expo-sqlite`: the boundary check lets only a file under
  `src/data/` named that way import a vendor SDK, so `expo-database-files.ts` would fail its
  `vendor-sdk` rule.
- **Startup time:** `VACUUM INTO` rewrites the whole file, before the first frame, under the splash.
  It costs roughly a full read and write of the file (milliseconds for a few MB; seconds for hundreds
  of MB on an old phone; measure with your largest realistic database). It runs only on the launch that
  upgrades.
- **Backups:** the snapshots sit beside `app.db`, so device backups carry them (next section). On
  Android, Auto Backup's rules take literal paths only (no wildcards, per the Auto Backup guide), and
  the per-version names make the set finite: a config plugin writes `res/xml/data_extraction_rules.xml`
  (Android 12+, `<cloud-backup>` and `<device-transfer>`) and `res/xml/backup_rules.xml`
  (`<full-backup-content>`, Android 11 and lower) with one
  `<exclude domain="file" path="SQLite/app.db.vK.bak"/>` per version K below the latest, and sets
  `android:dataExtractionRules` / `android:fullBackupContent` on `<application>`. Write that plugin
  with the build skill that owns native config; this skill does not ship it (not device-verified). On
  iOS no Expo API in SDK 57 sets `NSURLIsExcludedFromBackupKey` (checked in expo-file-system 57.0.7);
  pruning keeps the cost at two copies in iCloud, or a small native module can exclude the file.

## Repositories return Results

One repository per area: a port type (`src/data/tasks/task-repository.ts`), the SQLite adapter
(`sqlite-task-repository.ts`, the only code holding SQL for its tables), its failure naming
(`task-failures.ts`) and a fake for screen and store tests (`fake-task-repository.ts`: the same
validation and failures, `failNextWrite = { kind: 'storage-full' }` plans the next failure).

- **Every method returns `Result<T, TaskFailure>`** from `src/core/result.ts` and never throws for a
  data reason (error-handling-typed-results owns the Result type and its rules; this skill ships the
  module as a synced copy). `TaskFailure` is a kebab-case `kind` with typed params:
  `task-input-invalid` (`field`), `list-not-found`, `task-not-found`, `storage-full`, `storage-busy`,
  `storage-unavailable` (`code`). Why: an expected failure that throws crashes a release-build handler
  or is swallowed by a caller; a Result makes every caller handle it.
- **Convert once:** `attempt(() => driver.run(...), taskFailureOf(errorLog, { listId }))`.
  `src/data/to-storage-failure.ts` is the one place that reads SQLite errors (expo-sqlite's
  "Error code <n>:" on iOS, the one-character code on Android, node:sqlite's `errcode` in Jest), tested
  on the errors node:sqlite really throws (`test/sqlite/to-storage-failure.test.ts`). `task-failures.ts`
  names a broken foreign key as `list-not-found`, a full disk and a lock as their own kinds, and
  everything else as `storage-unavailable`, which alone is recorded with the raw error (a constraint the
  input schema should have caught is a bug).
- **Not found is a failure, not a silent success:** `setDone` and `removeList` check `changes`.
- The factory returns methods, directly or through helpers spread into it
  (`{ ...readMethods(deps), ...listWrites(deps), ...taskWrites(deps) }`, which keeps each function
  under the 40-line limit). The checker reads every returned object and follows the same-file helpers
  a method calls: a `parseNewTask(input)` that runs `v.safeParse` counts as validation, and the
  statements of a `deleteListRows(driver, id)` count toward the method's transaction. A statement in a
  function no method reaches (or at module level) is reported (`sql-outside-method`): keep SQL calls
  inside methods and the helpers they call.
- **Statements live in the repository file, named `sqlite-<area>-repository.ts`.** A data file that
  runs statements under any other name (a `note-repository.ts`, a sibling `task-rows.ts` holding a
  helper) is reported (`sql-outside-repository`): the repository rules read only repository files, so
  such a file would skip validation, row schemas and transactions unseen. The open path's own files
  (`app-database.ts`, `database-schema.ts`, `database-snapshots.ts`), the drivers, `migrations/`,
  `document/`, the peeks and the contract's reset modules run SQL by design. A second reset goes in
  `resetModules`, never in `sqlAllowed`: only reset modules get the protected-table guard and the
  one-transaction check (`protected-reset`, `transaction-write`), and `sqlAllowed` turns the SQL rules
  off for its files. Only other infrastructure (a debug read of `PRAGMA page_count`, background-tasks'
  `src/data/open-background-data.ts`, which opens its own connection at the current version and sets
  `APP_DB_PRAGMAS`, never migrating) goes in `sqlAllowed`: a name pattern would let any file of that
  name run statements unseen, while a contract entry is one reviewed line. SQL constants may
  live in a sibling file (`task-sql.ts`): the checker resolves imported constants and same-file aliases
  (`const query = SELECT_TASKS_SQL`).
- **`run` per statement, never `exec`, in a repository** (`exec-in-repository`): `exec('DELETE FROM
  tasks; DELETE FROM lists;')` runs each statement as its own autocommit and binds nothing; `exec` is for
  DDL and pragmas in the open path and the migrations.
- SQL statements are named constants (`INSERT_TASK_SQL`) or inline literals, uppercase keywords, bound
  parameters only (`?`), never string-built values: a template literal with `${...}`, or an SQL literal
  concatenated with anything but another literal, wherever it sits in a data file (`const sql = 'UPDATE
  tasks SET is_done = ' + flag + ...`), is reported (`sql-bound-params`); the runner's `PRAGMA
  user_version` stamp is the one exception (a pragma takes no parameters). Splitting a long literal
  with `'...' + '...'` is fine.
- The model hooks reach repositories through `useAppData()` (`src/data/app-data-context.tsx`); a
  feature never imports `src/data/sql-driver.ts` and never reaches a `.driver` or calls
  `driver.run/get/all/exec/transaction` (`sqlite-outside-data`), and SQL outside `src/data/` is
  reported (`sql-outside-data`): in any case when it names one of the app's tables, and any statement at
  all (`sqlite_master`, a `PRAGMA`, a constant imported from a data file) handed to a
  `.run/.get/.all/.exec` call.
- Methods are synchronous; a write has committed when it returns `ok`. Stores call the repository
  first and publish after `ok` (state-management-zustand: persist before publish). A model keeps the
  user's input until `ok` (error-handling-typed-results).
- `lastInsertRowId` is the new row's id (`id INTEGER PRIMARY KEY` is the rowid).
- **Value columns** follow value-objects-money-and-units (its `check-value-code` reads the migrations):
  money as `<name>_minor INTEGER NOT NULL` with the currency `TEXT` once on the aggregate row, rates as
  `<name>_bps INTEGER`, instants as `<name>_at_ms INTEGER` (`created_at_ms`, `written_at_ms`), calendar
  days as `<name>_on TEXT` (a date key), and no stored totals. STRICT tables refuse `DECIMAL` and refuse
  a `REAL` value in an `INTEGER` column; `avg()` and `total()` return `REAL`, while `sum()` over
  integers stays an integer and errors on overflow (verified on SQLite 3.53.2 through `node:sqlite`).
- **Other skills add AppData members**, one per repository or service, built in `openDeviceData` over
  the same driver: in-app-purchases adds `entitlements: createSqliteEntitlementRepository({ driver,
  errorLog })` (over this skill's v0001 `entitlements` table, validated before every write), and
  data-export-and-restore adds `backup: BackupService`, created with `isPersistent:
  database.isPersistent` so a session running in memory refuses a restore. data-export-and-restore
  imports this skill's `sql-driver.ts`, `migration-runner.ts`, `task-schema.ts` (`LIST_ROW`,
  `TASK_ROW`), `to-storage-failure.ts`, `migrations.ts` (`LATEST_DB_VERSION`, `MIGRATIONS`) and the
  frozen `db-v1.sql`: renaming one of those exports is a change to announce to it.
- A screen never imports a repository's SQLite adapter: it receives the port (architecture-and-boundaries).

## Validation at the boundary

- **Writes:** every INSERT/UPDATE method parses its input with a valibot `strictObject` schema
  (`v.safeParse(NEW_TASK, input)`) before binding. Invalid input returns
  `{ kind: 'task-input-invalid', field }` (the first failing path, never message text) and nothing is
  written; the form layer validated with the same schema first (forms-and-input). The schema limits sit
  inside the tables' CHECK constraints (valibot counts UTF-16 code units, SQLite `length()` counts
  characters, so the valibot bound is the stricter one). `Number.parseInt` or `JSON.parse` is not
  validation; the checker accepts only `v.parse`/`v.safeParse` (or `parse(SCHEMA)` from valibot), and
  a parse of a row the method read does not count: it checks the row, not what is about to be written.
- **Reads:** every row goes through its row schema (`v.safeParse(TASK_ROW, row)`), in the method or in
  a helper it hands the rows to (`readableRows`). The parse must take what the read returned: the call
  itself, a variable assigned from it, a `for...of` or `.map((row) =>` over it, or a helper's parameter
  that does the same; a parse of the input next to an unchecked `.map((row) => toItem(row as TaskRow))`
  is reported. A count or an existence check is a row too (`v.strictObject({ n: v.number() })`). An
  unreadable row (written by a buggy build, or a constraint bypassed) is skipped and logged alone; the
  rest of the list loads. One bad row never blanks a screen.
- **One schema language:** valibot (no `eval` or `new Function` on Hermes; `strictObject`, `variant`,
  `picklist`). A second validator (zod, yup, ...) is a second set of rules for the same data.
- **Strict shapes:** `v.object`, `v.looseObject` and `v.any` in a data schema are reported: an unknown
  key or a wrong type must be an error, not something that slips through.

## Transactions

- A method that runs two or more statements, or one statement per item of a loop, wraps them in
  `driver.transaction(() => { ... })`: a kill between them must not leave half a change, and one
  commit is one fsync under `synchronous = FULL` (a loop of autocommits is one fsync per row).
- One statement is atomic on its own (autocommit).
- A helper may hold the transaction itself: `function replaceRows(driver, rows) { driver.transaction(()
  => { for (...) driver.run(...) }) }` called alone from a method is covered (check-persistence reads
  the helper's own transaction). Calling such a helper twice from one method, or from inside the
  method's loop, is two commits again: move the transaction up to the method.
- **Derived rows change with their cause.** A row kept incrementally from others (a streak and stats
  row such as `activity_progress (id, body)`, read through its own valibot row schema) is written in
  the **same** repository transaction as the row that changes it, for example a `complete(input)`
  method that marks the task done and updates the progress row (dates-streaks-and-statistics,
  `examples/complete-task.ts`). Two methods called one after the other are two transactions: a kill
  between them leaves a done task with an old streak. Renaming a stored counter id is a data migration.
- **Never nest:** both drivers throw `NESTED_TRANSACTION_MESSAGE` before running the inner work, and
  the outer change rolls back whole. Code that may run inside a transaction must not open its own: the
  SQLite error log, for example, catches the refusal and hands the entry to its fallback log.
- Keep work inside a transaction short and synchronous: no awaiting, no UI.

## Resets and protected tables

`resetAllData(driver)` (`src/data/reset-data.ts`) deletes the user's own tables, children before
parents, in one transaction, with each statement written out literally. `contracts/persistence.json`
names the **protected tables** no reset may delete, update or drop: `entitlements` (a purchase ends only
with a dated revocation from the store, in-app-purchases) and diagnostics such as `error_log`. A reset
built from a table list (`` `DELETE FROM ${table}` ``) is reported: nothing proves the list never grows a
protected name. The test loads the frozen fixture, resets, and asserts the protected rows are unchanged.

Features never hold the driver, so `AppData` carries the reset as a Result:
`resetAllData: () => Result<void, StorageFailure>`, built once in `openDeviceData` by
`createResetAllData(driver, errorLog)`, which converts the throw, records the raw error (`storage`)
and returns the `StorageFailure`. A failed reset rolled back whole (the test forces the second
statement to fail and finds every row still there). It changes rows that several stores hold, so a
store layer calls it as `updateAndPublish(stores, () => data.resetAllData())` (state-management-zustand),
and a screen maps the `StorageFailure` to its own message (settings-and-preferences' `DataResetFailure`).
The settings and first-run flags are not in this database (they live in the key-value store), so the
reset never needs to name them, and must not clear that store either.

## Small preferences and secrets

- **Small preferences** (a theme, a dismissed tip, the direction guard) may use `expo-sqlite/kv-store`
  (`Storage.getItemSync`/`setItemSync`), behind a port whose adapter lives in
  `src/services/<concern>/kv-<concern>-adapter.ts`. It is a separate key-value database: no schema,
  no migrations, so nothing that needs either belongs there. An app that keeps only preferences there
  (no contract, no `src/data/`) gets `NOT APPLICABLE` from the checker after the repo-wide rules pass.
- **The global `localStorage`** is the same store. expo-sqlite's SDK 57 documentation offers
  `import 'expo-sqlite/localStorage/install'` as a drop-in `localStorage`; it puts kv-store's default
  instance on `globalThis.localStorage` (expo-sqlite 57.0.3: `localStorage = new Storage(KVStorage)`
  over the same `ExpoSQLiteStorage` database, read in its sources; a no-op on web, where the browser's
  own `localStorage` is used; checked 2026-10-03). It is synchronous, has no schema and no version, and holds preferences
  only. The install is the **first import of the adapter that reads it**,
  `src/services/<concern>/local-storage-<concern>-adapter.ts`, next to its port and fake like kv-store's:

  ```ts
  // src/services/preferences/local-storage-preferences-adapter.ts
  import 'expo-sqlite/localStorage/install';

  import type { PreferencesPort } from '@/services/preferences/preferences-port';

  export function createLocalStoragePreferencesAdapter(): PreferencesPort {
    return {
      theme: () => localStorage.getItem('theme'),
      setTheme: (theme) => {
        localStorage.setItem('theme', theme);
      },
    };
  }
  ```

  The composition root creates the adapter, so the global exists before the first read, and the
  adapter stays the only file that imports the SDK: architecture-and-boundaries' `vendor-sdk` rule
  reports the install anywhere else (a root layout or an app entry included). The checker counts it
  as kv-store (not a second store), accepts it in a preferences-only app (`NOT APPLICABLE`), and
  reports the install, a kv-store import or a `localStorage.` read (also as `globalThis.`, `window.`
  or `self.`) in `src/` outside a `services/<concern>/*-adapter.ts` (`sqlite-outside-data`). One file is
  exempt: `src/i18n/direction.web.ts`, web-support's direction module for the web build, where the
  browser's own `localStorage` holds the forced layout direction across the direction restart's reload
  (the counterpart of the native `forceRTL` flag, which I18nManager keeps outside every port). In
  other `.web` files the message names the browser's Web Storage, not kv-store.
- **On the web** (web-support owns the web build): the database lives in the browser's origin private
  file system, opened by expo-sqlite's worker. The synchronous `SqlDriver` works only after one async
  open has started that worker (web-support's `WebStorageGate` and `expo-sqlite-warm-up-adapter.web.ts`);
  only one tab can hold the files (the warm-up takes a Web Lock); data survives a reload but
  `navigator.storage.persisted()` is `false`, so the browser may evict it. `DatabaseFiles` has nothing
  to list there: web-support ships `expo-file-system-database-files-adapter.web.ts` (lists and removes
  nothing), because expo-file-system throws in a browser. Measured by web-support on expo-sqlite 57.0.3
  in Chrome.
- **Secrets and tokens** go to `expo-secure-store` (auth-and-secure-storage owns it).
- **Not allowed:** AsyncStorage (no transactions, no version; kv-store's default export is Expo's
  drop-in replacement for it, per its 57.0.3 type declarations), zustand's `persist` middleware (a
  second, unversioned copy of state), a second database engine or SQLite binding. MMKV is a fenced
  alternative for the key-value role only: set `"keyValueStore": "react-native-mmkv"` in the contract
  (without a contract, the one key-value store the app imports counts), and then kv-store is the second
  store.

## Server-owned data (networked apps)

In an app with a server, server state is TanStack Query over the `ApiClient` port
(networking-and-server-state owns it). This skill decides only where its local copies go:

- **A persisted query cache** (the last data shown offline or at a cold start) is a cache, not app
  data: no schema, no migrations, safe to drop. Persist it through a kv-store adapter in
  `src/services/<concern>/` (for example `src/services/query-cache/kv-query-cache-adapter.ts`, handing
  kv-store's AsyncStorage-compatible `getItem`/`setItem`/`removeItem` to the persister
  networking-and-server-state chooses), with a cache buster tied to the app version and a short max
  age, so the blob stays small (it rides in device backups). Not AsyncStorage (`second-persistence`),
  not the app database, and not a kv-store import in `src/api/` (`sqlite-outside-data`).
- **Data the user creates offline** (a task added on a plane) is app data: it goes in tables through
  a repository like any other row, plus an `outbox` table written in the same transaction (one row per
  pending change: `id`, `kind`, a `payload` validated on read, `created_at_ms`, `attempts`). A sync
  service outside the data layer reads `pendingChanges(limit)` and calls `markSynced(id)` after the
  server confirms, or `markRejected(id, status)` (a `rejected_status` column) when the server refuses
  the change for good, all repository methods returning synchronous Results; a server id goes in its own column, never in place of the local
  primary key. The outbox is a normal migration with its fixture.
- The split, agreed with networking-and-server-state: it owns the persister, the sync service and
  retries; this skill owns the tables, the outbox, its repository methods and the migrations.

## The synced-store profile (opt-in)

Some apps keep their data in a cloud database whose SDK holds its own offline cache on the device:
writes land in that cache at once, survive an app kill, and sync when the network returns. React
Native Firebase Firestore is the common case (its native iOS and Android SDKs persist the cache and
the queue of pending writes). For such an app the SDK's cache is the one copy of app data, and a
second local engine next to it would be the bug this skill exists to prevent. The profile says so
in the contract, and the checker stays strict around it.

**Example (a Tasks app that syncs tasks and lists across a user's devices):**

```json
{
  "$schema": "./persistence.schema.json",
  "mode": "synced",
  "keyValueStore": "expo-sqlite/kv-store",
  "syncedStore": { "package": "@react-native-firebase/firestore", "adapterDir": "src/data/firestore/" }
}
```

- **`syncedStore.package`** is the SDK's import path (its subpaths count). **`adapterDir`** is the one
  folder whose files may import it: inside the data folder or the services folder, never the whole
  source tree (the checker refuses `src/` as `contract`). Each file there implements a port
  (`src/data/tasks/task-store-port.ts`: `saveTask(task)`, `watchList(listId, onTasks)` returning its
  unsubscribe), and the composition root creates the adapter; features and stores see only the port
  and its fake. Tests, root mocks (`__mocks__/@react-native-firebase/firestore.ts`) and scripts may
  import the package to test it.
- **Modes.** `"mode": "synced"`: no SQLite database at all; device-only data (a draft, an upload
  queue, the in-progress screen state) lives in the key-value store behind a port, and the checker
  runs only the repo-wide rules, the profile and `contract` (an `expo-sqlite` database import or a
  `src/data/sql-driver.ts` under `synced` is a `contract` problem: switch to `tables`). `"mode":
  "tables"` (or `both`) with `syncedStore`: the synced store holds app data and SQLite tables hold
  device-only data that grows or needs queries (an upload queue with retry counts); every table rule
  of this skill applies to those tables.
- **Document codecs in `adapterDir` keep `v.object`.** Every installed app version reads and writes
  the same documents, so a codec that rejected unknown keys would fail on a field a newer version
  added; `v.object` drops it on read, and writes that merge (never replace) keep it on the server.
  `schema-strict` therefore skips `adapterDir`; table schemas elsewhere in the data folder stay strict.
- **What still fails under the profile:** the package outside `adapterDir`
  (`synced-store-outside-adapter`); AsyncStorage, MMKV (or any key-value store the contract does not
  name), zustand `persist`, another engine, and any other synced store, the SDK's Realtime Database
  beside its Firestore included (`second-persistence`); `expo-sqlite/kv-store` outside a preferences
  adapter (`sqlite-outside-data`).
- **Without the profile** a known synced store (`@react-native-firebase/firestore`,
  `@react-native-firebase/database`, `firebase/firestore`, `firebase/database`,
  `@powersync/react-native`) is a second engine (`second-persistence`), so adopting one is a
  deliberate contract change that a reviewer sees, ideally with a decision record next to it.
- **What the profile does not cover:** the synced store's own rules (one batched write per user
  action, no client transaction offline, never awaiting a commit in UI code, listeners unsubscribed,
  emulators only in development) belong to the SDK's own skill; for React Native Firebase that is
  firebase-rnfb, and its server-side security rules belong to firestore-rules-and-emulator-tests.
- **Why not the Firebase JS SDK for this:** on React Native the web SDK has no persistent cache
  (its IndexedDB persistence needs a browser), so writes queued offline are lost when the app is
  killed; the profile accepts any package, but only an SDK with a native persistent cache fits the
  "source of truth offline" role. Checked against the Firebase and React Native Firebase docs on
  2026-10-21 (re-verify: read the "Offline" pages of both docs).

## The error log table

`error_log` is created by migration 1. `src/services/error-log/sqlite-error-log-adapter.ts`
(`createSqliteErrorLogAdapter({ driver, clock, fallback })`) records an entry (insert and trim to the
newest 200 rows, in one transaction) and never throws: what the table refuses (before it exists,
inside another transaction, on a full disk) goes to `fallback` with the storage error, so nothing is
lost. `entries()` merges both, newest first, and validates each row (an `area` that is not a known
`ErrorSource` is skipped: tsc fails in the adapter when the port's union grows). The port and fake
(`error-log-port.ts`, `fake-error-log.ts` and its test) and `clock-port.ts` are architecture-and-
boundaries' canonical files, synced into this skill unchanged; the session's memory adapter is the
natural fallback. Nothing leaves the device unless crash reporting adds it.

## Where the file lives, and device backups

| | Path (expo-sqlite's `defaultDatabaseDirectory`) | Backed up by default |
|---|---|---|
| iOS | `<app container>/Documents/SQLite/app.db` (+ `-wal`, `-shm`, `.v<N>.bak`) | iCloud and computer backups include Documents |
| Android | `/data/data/<package>/files/SQLite/app.db` (+ `-wal`, `-shm`, `.v<N>.bak`) | Auto Backup includes the files directory, 25 MB per app (above it the backup is not uploaded), unless `android.allowBackup` is false |

The paths were read in expo-sqlite 57.0.3's native sources; the backup behaviour is each platform's
documented default (Android's Auto Backup guide, checked 2026-10-03), not device-verified here. A
backup taken while the WAL holds commits can capture the file and its WAL at different moments, so the
app checkpoints (`wal_checkpoint(TRUNCATE)`) when it goes to the background
(`useCheckpointOnBackground`). Snapshots: see "Snapshots" above.

## Adopting in an existing app

An app that already ships a database must not lose it on the update that brings this layer. Decide
which case you are in by reading a copy of a real installed file:
`node ${CLAUDE_SKILL_DIR}/scripts/inspect-database.mjs <copy of the file> --dump legacy.sql` prints its
`user_version` and writes its exact schema.

1. **Tables at user_version 0 (no versioning so far):** write a **baseline** `v0001-<name>.ts` whose
   CREATE statements are copied verbatim from the dump (SQLite compares the stored text, so whitespace
   counts), set `BASELINE = { version: 1 }` in `migrations.ts` (the template passes it to the open), and
   freeze the dump as `db-v1.sql` with `PRAGMA user_version = 1` at its end. On an installed phone the
   open path compares the file's schema with what migrations 1..1 create on an empty database; equal
   means "adopted" (snapshot, stamp 1, then v0002+); anything else stays `unversioned` in memory,
   untouched. Make the old tables STRICT and add foreign keys in v0002 (a table rebuild,
   `rebuildsTables: true`), never by editing the baseline.
   **Old builds rarely left one schema.** A column added by `ALTER TABLE` is stored as
   `...body TEXT NOT NULL\n, pinned INTEGER DEFAULT 0)` on phones that upgraded and as the full CREATE on
   fresh installs of the later build: the same structure, other text, so only one population would
   match. Dump a real file of every population (old and new installs of each legacy build you can
   still get), and for each schema that differs from the baseline add its CREATE statements, verbatim
   from its dump, to `BASELINE.variants`, freeze that dump as `db-v0-<variant>.sql` (user_version 0) with
   its checksum, and list it in `LEGACY_FIXTURES` of the fixtures test. The step after the baseline
   rebuilds every table a variant differs in (create new, copy every row, drop, rename), so every
   population ends with one schema; the fixtures test and the checker adopt and upgrade each
   `db-v0-<variant>` and require the fresh schema and every row. `BASELINE` is frozen once it ships.
2. **An existing user_version numbering** (Expo's documented `migrateDbIfNeeded` in SQLiteProvider's
   `onInit` uses user_version too): backfill one frozen `vNNNN` step per existing version, reproducing
   exactly what each old build ran, so installed files open as `ready` or upgrade from their number.
   Make `db-vN.sql` fixtures from old builds' files where you still can; a fixture rebuilt by running
   the backfilled steps proves only the steps against themselves, so say so in the report.
3. **Drizzle or SQLiteProvider apps:** a Drizzle file usually keeps user_version 0 and tracks its
   migrations in `__drizzle_migrations`; adopt it as case 1 with that table in the baseline, then drop
   it in v0002 once Drizzle is gone. A SQLiteProvider app opens through `onInit`: move the open to the
   root layout (synchronous, `openAppDatabase`) and treat its migrations as case 1 or 2.
4. **Data in AsyncStorage (or another store):** import it once after the database is open, never
   before the first frame (AsyncStorage is asynchronous). Write the rows and a done flag (a row in a
   small `imports` table, created by its own migration) in one transaction, so a kill mid-import simply
   reruns it; skip when the flag is set. List the importer in `contracts/persistence.json`
   `legacyImports` (the checker then allows its AsyncStorage import) and give it a file-scoped exception
   in `eslint.config.mjs` (typescript-and-lint-rules), keep the old keys for a release, and delete the
   importer, its exception and the package in a later release. Deleting the old data is irreversible:
   stop and ask the developer first.

Test each case in `test/sqlite/app-database.test.ts` style: build the legacy file with a plain driver,
open it through `openAppDatabase`, and assert the outcome and that every legacy row survives.

## When multi-package

With npm workspaces, the data layer lives in one package (for example `packages/data/src/` with the
same `src/data/` shape inside, or the app's own `apps/mobile/src/data/`). Run the checker once per app:
`node ${CLAUDE_SKILL_DIR}/scripts/check-persistence.mjs . --data-dir apps/mobile/src/data`
(`rn-skills.config.json` `dataDir` works too). The package that holds the driver declares `expo-sqlite`
as a peer dependency and each app installs it with `npx expo install expo-sqlite`. The migration
replay resolves the root `tsconfig.json` paths; if a workspace alias does not resolve, pass `--no-replay`
and rely on the fixtures test.

## Fenced alternatives: SQLiteProvider and Drizzle

- **SQLiteProvider** (expo-sqlite's React provider with `onInit` and Suspense) is Expo's documented
  starting point. It is asynchronous and context-bound: the app cannot hydrate stores before the first
  frame, and Jest cannot run the SQL on Node through it. Use the port; if a team keeps the provider,
  call `openAppDatabase` semantics (version check, pragmas, snapshot, frozen steps) from `onInit`.
- **Drizzle** (`drizzle-orm` with its expo-sqlite driver) keeps its own migration files. Keep the rules
  (WAL + FULL + foreign keys, snapshot first, frozen shipped migrations, fresh equals upgraded, kill
  test). The checker targets the SqlDriver layout; with Drizzle, run `inspect-database` and the kill
  test, and keep the static rules by review.

## What check-persistence reports

| Rule | Means |
|---|---|
| `contract` | `contracts/persistence.json` is missing or a key is malformed (mode `synced` without `syncedStore`, an `adapterDir` outside the data and services folders, an SQLite database under mode `synced`) |
| `missing-file` | a required data-layer file, a reset module, a repository, or a repository's node:sqlite test is missing |
| `sqlite-outside-data` | `expo-sqlite`, `node:sqlite` or the `SqlDriver` port (`src/data/sql-driver.ts`) imported outside the data folder, tests and scripts (the SQLite error log adapter and `sqlAllowed` may hold the port); `expo-sqlite/kv-store`, `expo-sqlite/localStorage/install` or a `localStorage.` read in `src/` outside a preferences adapter (`services/<concern>/*-adapter.ts`); outside the data folder, in a file that imports the data layer, a `driver.run/get/all/exec/transaction` call or `.driver` on `useAppData()`, an opener or an `AppData`/`AppDatabase` value (or cast to `SqlDriver`) |
| `second-persistence` | AsyncStorage, another engine or binding, zustand `persist`, a key-value store the contract does not name, or a synced store the contract does not declare as `syncedStore` (a file in `legacyImports` may import an older engine) |
| `synced-store-outside-adapter` | the `syncedStore` profile's package imported outside `syncedStore.adapterDir` (tests, root mocks and scripts excepted) |
| `single-validator` | zod, yup, superstruct, io-ts, joi, ajv, arktype or typebox imported |
| `sql-outside-data` | SQL text outside the data folder: uppercase keywords, any case when it names one of the app's tables, or any statement handed to a driver call (the SQLite error log adapter and contract `sqlAllowed` excepted) |
| `sql-bound-params` | SQL built from a value in the data folder (a template literal with `${...}`, or an SQL literal concatenated with a non-literal anywhere in the file); the `PRAGMA user_version` stamp excepted |
| `sql-outside-repository` | a data-folder file other than `sqlite-<area>-repository.ts` runs statements (the open path's files, drivers, `migrations/`, `document/`, peeks, reset modules and `sqlAllowed` excepted) |
| `open-at-import` | `openDeviceData`, `openDeviceDatabase` or `openAppDatabase` called at module level in `src/`, passed to `useState` as a result (`useState(openOnce())` opens on every render), or an opener (or a same-file function reaching one) called in a component or hook body (`const data = openOnce();`) |
| `pragmas` | the pragma constant lacks WAL, FULL or foreign keys, is never executed, or a table is not STRICT |
| `newer-db-crash` | the open path throws, runs the pragmas before the version check, or has no `newer-version` outcome |
| `unversioned-data` | the open path does not read the file's tables before the pragmas, or has no `unversioned` outcome; a `db-v0-<variant>.sql` that neither the baseline nor a variant matches; `BASELINE` set but never passed to the open |
| `migration-snapshot` | no `VACUUM INTO` before the migration in the same function; its catch does not return; old snapshots are never pruned; a snapshot name embeds a time |
| `transaction-write` | a step and its stamp, a multi-statement or per-item-loop method (statements of the helpers it calls included), or a reset outside one transaction; no `wal_checkpoint(TRUNCATE)` |
| `validate-before-write` | a repository method writes (itself or through a helper) before `v.parse`/`v.safeParse` of its input, here or in a helper it calls first; a parse of what a driver read returned does not count; a `.run` whose SQL cannot be resolved counts as a write (no repository factory to read is reported too) |
| `exec-in-repository` | `driver.exec` in a repository file |
| `sql-outside-method` | a statement in a repository file outside every method and every helper a method calls |
| `validate-on-read` | what a read returns (`.get`/`.all` on the driver, whatever its SQL argument, or rows a same-file helper hands back) never reaches a schema check: no parse takes the call, a variable or loop binding derived from it, or a helper parameter that reaches one; also a read a helper makes and neither checks nor returns |
| `schema-strict` | `v.object`, `v.looseObject` or `v.any` in a data schema (the `syncedStore` adapter folder excepted) |
| `protected-reset` | a reset touches a protected table, or builds its SQL from a value |
| `peek-writes` | a `peek-*.ts` writes, runs DDL or migrates |
| `no-background-checkpoint` | no background checkpoint, or the hook is never called |
| migration and fixture rules | see `migrations-and-fixtures.md` |

`NOT APPLICABLE` when `package.json` lists no local persistence package, or when the app keeps no
database (no contract, no data folder, expo-sqlite not imported or only as `expo-sqlite/kv-store` or
`expo-sqlite/localStorage/install`) and the repo-wide rules (`sqlite-outside-data`,
`second-persistence`, `single-validator`, `sql-outside-data`) passed.

## Limits of the static checks

check-persistence reads source text, not types, so some shapes are judged by convention. Review what it
cannot see; the node:sqlite tests and the kill test cover the behaviour.

- **A driver is recognised by name or by its SQL.** In the data folder every `.run(`/`.transaction(`
  counts; `.exec(`, `.get(` and `.all(` count on a receiver named `driver`, `db`, `database`, `reader`,
  `connection` (or ending in `Driver`, `Db`, `Reader`), a name annotated `SqlDriver`/`SqlReader`, or one
  taken from `.driver`/`{ driver: x }`, and on any receiver when the argument resolves to SQL. A driver
  passed around under another, unannotated name (`const s = deps[key]`) and fed computed SQL is not seen.
- **SQL is resolved statically:** literals, same-file constants and aliases, and constants imported from
  another repo file. SQL built at run time is unknown: a `.run` with it counts as a write (it must be
  validated first), a `.get`/`.all` as a read (it must reach a row schema).
- **Helpers are followed within one file.** A helper imported from another data file is not followed;
  instead that file is reported (`sql-outside-repository`) because it runs statements.
- **Outside the data folder,** `.driver` and `driver.run(...)` are reported only in files that import a
  data module (how a feature gets the data layer); `AppData` carries no driver, so tsc stops the rest.
  `.driver` counts only on the data layer: a chain that starts at `useAppData()` or an opener, a name
  annotated, cast or assigned from `AppData`/`AppDatabase` (or from one of those names), or a value cast
  to `SqlDriver`; a `.driver` on the app's own nouns (`order.driver?.name`) is left alone, with no
  `sqlAllowed` entry needed.
- **Validation is recognised by valibot calls** (`v.parse`/`v.safeParse`, `parse(SCHEMA)` imported from
  valibot, a `v.safeParser(SCHEMA)` function) and by what they take, followed by name inside one method
  and one file: declarations, `for...of` bindings, array callbacks (`map`, `flatMap`, `filter`, ...),
  return values and helper parameters. Rows moved through an object field (`state.rows = driver.all(...)`),
  a closure or another file are not followed, and a parse counts for every row of the value it takes, not
  for each field; which schema a parse uses is not checked (`v.safeParse(LIST_ID, row)` counts).
