# Forward-only migrations and frozen fixtures

A shipped schema is a compatibility contract: phones in the field hold databases at every version the
app ever shipped, and each one must upgrade exactly as tested. The schema changes only through a new
version: one frozen step, one frozen fixture database, a recorded checksum. `examples/migration-v2/`
is a complete, verified v1 to v2 change to imitate. For the ritual around a release (snapshot first,
every from-to path, a forced-failure restore drill), hand off to `run-migration`.

## Contents

- The rules
- The runner
- A step file
- Adding version N+1, step by step
- Changes ALTER TABLE cannot make: the table rebuild
- Frozen fixtures and their checksums
- Making a fixture with inspect-database --dump
- Fresh equals upgraded: the replay
- What the tests prove
- A file from a newer build, a failing step, a damaged file
- Which changes need a new version
- What check-persistence reports

## The rules

1. One file per version: `src/data/migrations/v0001-create-lists-and-tasks.ts`, `v0002-...`, numbered
   without gaps, registered in `MIGRATIONS` (`migrations.ts`) at position N, declaring `version: N`
   and `name: '<the file name without the number>'`. (Leading digits are not kebab-case for the lint
   rules, hence the `v`.)
2. **Never edit a shipped step, fixture or checksum.** An installed app never reruns a step it already
   ran: an edit changes fresh installs only, and the two populations drift apart forever.
3. **A step is frozen code:** literal SQL, at most `import type { Migration }`, no clock, no
   randomness, no imported constants or schemas (a later rename would silently change what old
   installs run).
4. **Forward only:** no down steps (never run, false confidence; fix forward with a new version), no
   `PRAGMA user_version` in a step (the runner stamps it), no BEGIN/COMMIT (the runner owns the
   transaction), no `PRAGMA foreign_keys` (a no-op inside a transaction: use `rebuildsTables: true`,
   which every step that drops or renames a table must declare).
5. **Each step and its version stamp commit together:** both, or neither. A kill mid-upgrade leaves
   the file at the last completed version, and the next launch continues from there.
6. **Snapshot first:** a database that holds tables is copied (`VACUUM INTO '<file>.v<from>.bak'`)
   before its first pending step runs; no snapshot, no migration. The copy is reused while a step keeps
   failing and pruned to the newest two after a success (`tables-and-repositories.md`, "Snapshots").
7. **Every shipped version has a frozen fixture** (`fixtures/db-vN.sql`, the database that version
   wrote, with representative rows) and a recorded checksum; the fixtures test replays each one.
8. **A fresh install and every upgraded fixture end with the same schema**, every table keeps at
   least the rows it had, and every upgraded row still passes `integrity_check` and
   `foreign_key_check`. Fixtures are upgraded with foreign keys on, as the app's pragmas leave them.
9. A schema change lands in one reviewed change: a `Gate-Change:` commit trailer or a CODEOWNERS rule
   on `src/data/migrations/` (golden-and-snapshot-tests, git-commits-and-reporting).

## The runner

```ts
// src/data/migrations/migration-runner.ts (a shared file: do not edit your copy)
export type Migration = { version: number; name: string; up: (driver: SqlDriver) => void; rebuildsTables?: boolean };
export type MigrationResult =
  | { kind: 'up-to-date'; version } | { kind: 'migrated'; from; to }
  | { kind: 'newer'; found; latest } | { kind: 'failed'; from; at; reason; error };   // error: what the step threw
readUserVersion(driver)                 // PRAGMA user_version; 0 for a new file
migrationListProblems(migrations)       // versions 1..N in order, kebab-case names
migrateDatabase(driver, migrations)     // never throws
```

`migrateDatabase` reads the version, refuses a broken list before touching the file, reports a newer
file without writing, and applies each pending step as `transaction(() => { up(driver); stamp })`.
`user_version` is transactional (verified on node:sqlite: a rolled-back step leaves the old value). A
step that throws rolls back and becomes `{ kind: 'failed', at, reason, error }`; earlier steps stay
committed. The open path (`openAppDatabase`) records `error` (the raw error, with its stack) in the
error log and turns the result into the `migration-failed` outcome (`storage-full` when SQLite reports
a full disk) and an in-memory session.

## A step file

```ts
// src/data/migrations/v0002-add-task-due-date.ts
import type { Migration } from '@/data/migrations/migration-runner';

export const ADD_TASK_DUE_DATE: Migration = {
  version: 2,
  name: 'add-task-due-date',
  up: (driver) => {
    driver.exec(`
ALTER TABLE tasks ADD COLUMN due_on TEXT
  CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
CREATE INDEX tasks_by_due_date ON tasks (due_on) WHERE due_on IS NOT NULL;
`);
  },
};
```

New tables end with `) STRICT`. New columns are nullable or carry a constant DEFAULT (ADD COLUMN
cannot add a NOT NULL column without one). Data moves are SQL (`UPDATE tasks SET ... WHERE ...`),
derived from existing columns only.

## Adding version N+1, step by step

1. Write the failing test first: `test/sqlite/v000N-<name>.test.ts` loads `db-v(N).sql`, migrates, and
   asserts exactly what old installs get (existing rows unchanged, new columns as designed, the new
   constraint refusing bad values). `examples/migration-v2/test/sqlite/v0002-add-task-due-date.test.ts`.
2. Write the step `src/data/migrations/v000N-<name>.ts` and append it to `MIGRATIONS`.
3. Update what reads and writes the changed tables in the same change: the repository's SELECT list,
   row schema (`strictObject` rejects a row that lacks or adds a column) and input schema.
4. Run the tests; `tsc` finds every caller the new types touch.
5. Freeze the new version's fixture: open a database at the new version (a fresh install in a
   development build, or a Node script over `openAppDatabase`), add representative rows, copy the
   file out, and dump it (next section) to `src/data/migrations/fixtures/db-v(N+1).sql`. Keep the
   hostile text the v1 fixture has in every new table and column that holds text: an apostrophe, a
   non-ASCII letter and an emoji (run-migration's drill checks it for the pending version).
6. Record its checksum in `fixture-checksums.ts` (the dump prints it; the fixtures test prints the
   actual value on a mismatch) and add `{ name: 'db-v(N+1)', version: N+1 }` to `FIXTURES`.
7. Run `check-persistence`: the replay proves fresh equals upgraded for every fixture.
8. Name the new version in the change report: it is permanent for every phone that installs it.

## Changes ALTER TABLE cannot make: the table rebuild

A new constraint on an existing column, a type change, or dropping a column with dependents needs a
rebuild: create `tasks_new` with the new shape, `INSERT INTO tasks_new (...) SELECT ... FROM tasks`,
`DROP TABLE tasks`, `ALTER TABLE tasks_new RENAME TO tasks`, recreate its indexes and triggers. Mark
the step `rebuildsTables: true`. The runner then turns foreign keys off before BEGIN, runs the step,
checks `PRAGMA foreign_key_check` before COMMIT (a broken reference fails the step), and turns them
back on. Why it matters, verified on node:sqlite: rebuilding a parent table inside a transaction with
foreign keys on deletes every `ON DELETE CASCADE` child row (the implicit DELETE of `DROP TABLE`), and
the schema still matches a fresh install, so only a row count notices. The checker reports a step whose
SQL drops or renames a table without the flag (`migration-rebuild`), and the replay counts every
table's rows before and after (`migration-replay`: `tasks: 0 of 4`). Copy with a plain
`INSERT INTO ... SELECT`, never `INSERT OR IGNORE`: a row the new constraint refuses would vanish
silently (the replay reports that too); clean such rows with an UPDATE first, or move them to an
archive table.

## Frozen fixtures and their checksums

```ts
// src/data/migrations/fixtures/fixture-checksums.ts
export const FIXTURE_CHECKSUMS = { 'db-v1': '7cb0d956' } as const;   // fnv1a32 of the text, CRLF read as LF
```

A fixture is a deterministic `.sql` dump (reviewable, diffable, loads in one transaction with foreign
keys off): tables in creation order with their rows, `sqlite_sequence`, indexes, then
`PRAGMA user_version = N`. The template's `db-v1.sql` holds two lists, four tasks (one done, one with
an apostrophe, one Arabic, one with an emoji), a Premium entitlement and two error-log rows, so text
handling and AUTOINCREMENT state are part of what every upgrade must keep. Its checksum was recomputed
by an independent Python implementation (UTF-16 code units, FNV-1a 32) and matched.

An app that adopted an unversioned database also keeps one `fixtures/db-v0-<variant>.sql` per schema
older builds left (user_version 0, its checksum recorded, listed in `LEGACY_FIXTURES`), matching
`BASELINE.variants` in `migrations.ts` (`tables-and-repositories.md`, "Adopting in an existing app").

## Making a fixture with inspect-database --dump

```sh
node ${CLAUDE_SKILL_DIR}/scripts/inspect-database.mjs <copy of app.db> --expect-version 2 \
  --dump src/data/migrations/fixtures/db-v2.sql
```

It works on a copy, checks the database first, writes the dump with a first line naming the file,
and prints the checksum to record. To get the copy from a device: `--udid <udid> --bundle-id <id>`
(iOS simulator) or `--serial <serial> --package <id>` (Android emulator; run-as needs a debuggable
build). A dump of a database restored from the dump is byte-identical (checked on the template).

## Fresh equals upgraded: the replay

The fixtures test (`test/sqlite/migration-fixtures.test.ts`) and the checker both:

1. migrate an empty in-memory database through every step (a fresh install) and read its schema
   (`sqlite_master` without SQLite's own objects);
2. load each frozen fixture, turn foreign keys on (as the app's pragmas do), count every table's rows,
   migrate it, and require a `migrated` (or `up-to-date`) result, the same schema, `integrity_check =
   ok`, an empty `foreign_key_check`, and no table with fewer rows than before;
3. for each `db-v0-<variant>` fixture: require that the open path would adopt it (`isAdoptable`: its
   schema is migrations 1..`BASELINE.version` or one of `BASELINE.variants`), stamp the baseline, and
   check it like step 2. Every variant needs its fixture.

SQLite stores each CREATE statement verbatim and ALTER TABLE rewrites it the same way on both paths,
so an exact comparison works. It is what catches an edited shipped step: the fixture keeps the schema
the step used to create; the edited step now creates another. The checker loads the app's own runner
and `MIGRATIONS` through Node type stripping (steps import only types), so it needs no Jest run.

## What the tests prove

| Test | Proves |
|---|---|
| `migration-runner.test.ts` | order, stamping, newer file untouched, rollback keeps the last version, a broken list refused, the rebuild keeps cascading children and refuses a broken reference |
| `migration-fixtures.test.ts` | every fixture is unchanged, upgrades (foreign keys on) to the fresh schema, and keeps every row of every table, readable and consistent; every legacy fixture is adopted and does the same |
| `v000N-<name>.test.ts` | what that version promises old installs |
| `app-database.test.ts` | pragmas, snapshot under the from-version before migrating, one reused snapshot across failing launches, a partial snapshot replaced, pruning to the newest two, refusing to migrate without a snapshot, newer, unversioned (colliding and unrelated tables) and unreadable files untouched, a baseline adopted and a near-baseline refused, two legacy populations (ALTER TABLE and a fresh CREATE) both adopted through a variant and made one by the rebuild, the ALTER population refused without its variant, the raw error recorded, checkpoint |
| `sql-driver-contract.test.ts` | both drivers keep one transaction contract, nesting refused on both (shared file) |

## A file from a newer build, a failing step, a damaged file

- **Newer** (`user_version` above the list): not read beyond the version, not written, not migrated;
  the session runs on an in-memory database at the latest schema; outcome `newer-version`.
- **A failing step:** rolled back; the file stays at the last completed version; in-memory session;
  outcome `migration-failed` with the step's name and error. Fix forward in the next build.
- **Not a database** (`file is not a database`): untouched, in-memory session, outcome `unreadable`.
  Never delete it automatically; support can recover rows from it or from a `.bak` snapshot.
- **A user_version 0 file that holds tables** (an earlier data layer): untouched, in-memory session,
  outcome `unversioned`, unless its schema is exactly the declared baseline or one of its variants
  (`tables-and-repositories.md`, "Adopting in an existing app").
- **A committed step that was wrong:** restore the snapshot taken before it (with the app closed, copy
  `app.db.v<from>.bak` over `app.db` and remove `-wal`/`-shm`). That is irreversible for any data
  written since: stop and ask the developer first; run-migration covers the drill.

## Which changes need a new version

- A new index only (`CREATE INDEX` changes no data) still changes the schema: it is a new version.
- Changing what the app writes into existing columns (a new allowed value in TEXT) without a schema
  change: no version, but the row and input schemas change, and old rows must still parse.
- A new row in a lookup table the app seeds: a new version with an INSERT, so every install gets it.
- Everything else that touches `sqlite_master` is a new version.

## What check-persistence reports

| Rule | Means |
|---|---|
| `migration-chain` | a gap in the numbers, a step not registered at its position, a wrong `version` or `name` |
| `migration-pure` | a step imports runtime code, or reads the clock or randomness |
| `migration-forward-only` | a step declares `down`, stamps `user_version`, opens a transaction, holds BEGIN/COMMIT, or toggles `foreign_keys` |
| `migration-rebuild` | a step drops or renames a table without `rebuildsTables: true` |
| `transaction-write` | the runner does not wrap a step and its stamp in one transaction |
| `migration-snapshot` | no `VACUUM INTO` right before the migration in the same function, a failed snapshot's catch that does not return, snapshots never pruned, or a snapshot name that embeds a time |
| `fixture-missing` | a shipped version has no `db-vN.sql`, a fixture has no checksum entry, or a `BASELINE` variant has no `db-v0-<variant>.sql` |
| `fixture-frozen` | a fixture's checksum or its `user_version` changed |
| `fixture-untested` | `FIXTURES` (or `LEGACY_FIXTURES`) in the fixtures test does not list a fixture |
| `migration-replay` | on node:sqlite with foreign keys on: a fresh install fails, an upgrade fails, an upgraded fixture's schema differs from a fresh install, its rows break integrity or foreign keys, or a table holds fewer rows than before |
| `unversioned-data` | a `db-v0-<variant>.sql` that neither the baseline nor a variant matches (it would open in memory on every launch) |
| `pragmas` | a table created by a step is not STRICT |
