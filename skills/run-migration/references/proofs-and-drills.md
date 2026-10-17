# Proofs and drills: what each test proves, and how to write it

Every rule of the ritual has a proof that runs without a device: Jest tests in the app (they run in
CI on every change) and `check-migration.mjs`, which runs the same replay on Node's `node:sqlite`
through the app's own runner and open path, without Jest. This reference explains each proof, how
to write the one test that is new per version (the content test), and what the checker reports.

## Contents

- The proofs at a glance
- The content test
- Hostile rows
- Every from-to path
- The forced-failure restore drill
- How the checker runs the app's code
- What check-migration reports
- Pitfalls
- Limits

## The proofs at a glance

| Proof | Where | Catches |
|---|---|---|
| Content test `vNNNN-<name>.test.ts` | Jest, one per version from 2 | a step that keeps the schema right and the values wrong (a backfill off by one, a mangled copy) |
| Every from-to path `migration-paths.test.ts` | Jest + checker `every-path` | a step that fails on old data but not on a fresh install; a pending step edited after its fixture was frozen; an edited shipped step; lost rows; broken foreign keys |
| Restore drill `migration-restore-drill.test.ts` | Jest + checker `restore-drill` | no snapshot before migrating; a step that half-commits; a snapshot that does not restore; a previous build that writes a newer file |
| Ledger `contracts/schema-ledger.json` | checker `ledger`, `shipped-frozen`, `ledger-append-only` | any byte change to a shipped step or fixture, a rewritten history |
| Fixture fixtures test (persistence-and-migrations) | Jest + check-persistence | an edited fixture checksum, a fixture missing from `FIXTURES`, fresh ≠ upgraded |

The fixtures test of persistence-and-migrations replays every fixture to the latest version. The
paths test here goes further: from every fixture to every later version, compared with that
version's own frozen schema. That is what notices a shipped step v2 that was edited when v5 is the
latest: upgrading `db-v1` to v2 no longer gives `db-v2.sql`'s schema, although v1 to v5 still may.

## The content test

One per version from 2, at `test/sqlite/v000N-<name>.test.ts`, written before the step
(`examples/v0002-pending/test/sqlite/v0002-add-list-sort-order.test.ts` is complete):

```ts
const V1 = join(__dirname, '..', '..', 'src', 'data', 'migrations', 'fixtures', 'db-v1.sql');

function v1Database(): ClosableSqlDriver {
  const driver = createNodeSqliteSqlDriver(':memory:');
  driver.exec(readFileSync(V1, 'utf8'));
  driver.exec('PRAGMA foreign_keys = ON');     // as the app's pragmas leave them
  return driver;
}

it('orders the v1 lists by creation and changes no other value', () => {
  const driver = v1Database();
  const lists = rowsOf(driver, 'lists');       // every row, ordered by every column
  const tasks = rowsOf(driver, 'tasks');
  expect(migrateDatabase(driver, MIGRATIONS)).toStrictEqual({ kind: 'migrated', from: 1, to: 2 });
  expect(rowsOf(driver, 'lists')).toStrictEqual(lists.map((list, index) => ({ ...list, sort_order: index })));
  expect(rowsOf(driver, 'tasks')).toStrictEqual(tasks);   // untouched tables stay byte for byte
  driver.close();
});
```

- Start from the frozen `db-v(N-1).sql`: that is the database the step meets on every phone.
- Read every row before, migrate, read every row after, and state the exact relation: unchanged
  columns equal, new columns as designed, nothing else. `rowsOf` (`test/sqlite/database-content.ts`)
  orders rows by all columns, so the comparison does not depend on page order.
- Assert the tables the step does not touch too: a rebuild that drops a parent table with foreign
  keys on deletes the cascading children (persistence-and-migrations, "the table rebuild").
- Pick out the hostile rows by id and compare them as literals: a test that only compares
  "before" with "after" through the same transform can share the transform's bug.
- Add one test that the new constraint refuses a bad value (`CHECK constraint failed`).
- A count or a schema comparison alone is not a content test; the checker requires the test to read
  values (`rowsOf`, `contentOf`, or a `SELECT` of values through the driver; `SELECT COUNT(*)` and
  reads of `sqlite_master` or a `pragma_` table do not count) and to load `db-v(N-1)`.

## Hostile rows

The frozen fixture of the pending version is where the next step will be tested, so it is frozen
with rows that break careless SQL: an escaped apostrophe (`'Mum''s birthday'`), a non-ASCII letter
(Arabic `'شراء الحليب'`, an accented `'Crème'`), an emoji (a character outside the Basic Multilingual
Plane, two UTF-16 code units), and where the schema allows: a NULL, an empty or whitespace-only
string, a double quote and a backslash. Why: a rebuild's `INSERT … SELECT` with a function on a text
column (`substr`, `replace`, `trim`, `lower`), a JavaScript data move that splits by `length`, or a
byte-length CHECK mangles exactly these; `'test1'` survives everything and proves nothing. The
checker requires the first three in the pending fixture's INSERT lines (`hostile-rows`).

## Every from-to path

```
from ∈ {0 (an empty file)} ∪ {every version with a frozen db-vK.sql below the latest}
to   ∈ from+1 … latest
```

For each pair the paths test loads `db-v<from>.sql` (or nothing), turns foreign keys on, runs
`migrateDatabase(driver, MIGRATIONS.slice(0, to))`, and requires: the result `migrated` from→to;
the schema equal to `db-v<to>.sql`'s (the frozen target; a fresh install's for a target without a
fixture); `integrity_check = ok` and an empty `foreign_key_check`; no table with fewer rows than
before. With 5 versions that is 15 runs; each takes milliseconds on an in-memory database.

Why pairs and not only "every fixture to latest": users skip updates (a phone at v1 meets v5
directly), device backups (iCloud, Android Auto Backup) restore an old file into a new build, and an
intermediate target catches an edited shipped step that later steps happen to paper over. Why the
empty file: a step that inserts a fixed row works on a fresh install and fails on every phone that
already has that row; only the pair from a fixture shows it (the self-test plants exactly this).

## The forced-failure restore drill

Through the app's real `openAppDatabase` on real files in a temporary folder:

- **A. A step fails halfway.** The newest step (with only v1, a stand-in step after it) runs its SQL
  and then throws, as a bug or a full disk does. Expected: outcome `migration-failed`, an in-memory
  session, the file's content as before (same schema, rows and `user_version`), and the snapshot
  `<file>.v<from>.bak` holding the same content. Proves the step and its stamp share one transaction
  and the snapshot is taken before any step.
- **B. A committed wrong step.** A step that deletes every row commits (outcome `migrated`, every
  table empty). The snapshot is restored with the app stopped (the current file, `-wal` and `-shm`
  moved aside, the copy put in its place) and must equal the database before, and open as `ready`.
  Proves the way back exists and works, which is the whole point of the snapshot.
- **C. The previous build.** The newest fixture opened with every step but the newest, as after
  older code reaches the phone again: outcome `newer-version`, the same content, the same bytes
  (sha256 of the file) and no `-wal` left beside it. Bytes, because a statement can change the file
  without changing a row: `PRAGMA optimize` or `ANALYZE` fills `sqlite_stat1`, `VACUUM` rewrites
  every page. Proves a rollback cannot destroy the file (it still hides it: release-ritual.md, "Store
  builds, EAS Update and rollbacks"). The static order (version read before the pragmas) is
  persistence-and-migrations' check-persistence rule.

The Jest template `migration-restore-drill.test.ts` runs A, B and C on every CI run; the checker
runs them again before every release. `restoreSnapshotFiles` (`test/sqlite/restore-snapshot-files.ts`) is
the same procedure `restore-snapshot.mjs` performs on a device.

## How the checker runs the app's code

`check-migration` imports `src/data/migrations/migration-runner.ts`, `migrations.ts` (and through it
every step) and `src/data/app-database.ts` with Node's type stripping and the repo's `tsconfig.json`
aliases (`@/*`), with no Jest and no Babel. That works because steps import only types, and the open
path imports only pure modules. A step that imports runtime code fails to load and is reported as
`every-path` (persistence-and-migrations rule 4 forbids it anyway). Databases are `node:sqlite`
`DatabaseSync` with foreign keys off until the app's pragma, as the SQLite inside expo-sqlite ships;
a nested transaction is refused, as both app drivers refuse it.

## What check-migration reports

| Rule | Means | Usual fix |
|---|---|---|
| `ledger` | the ledger is missing, not JSON, or an entry is malformed (version order, hashes, date) | copy the template; restore from git; let record-shipped write entries |
| `ledger-append-only` | with `--base`/`--base-ledger`: an entry was changed or removed | restore the entry; a change of schema is a new version |
| `shipped-frozen` | a shipped step was edited, renamed or deleted, or its fixture changed | `git checkout <ref> -- <file>`; fix forward in a new version |
| `bump-by-one` | two or more pending versions, a gap in the step numbers, or `MIGRATIONS` and the step files disagree (a file not imported, not in the array, out of order, or with another `name`) | fold the pending steps into one; number one above the last; list every file once, in order |
| `pending-fixture` | the pending version has no `db-vN.sql`, or it stamps another version | dump it from a version-N database |
| `hostile-rows` | the pending fixture lacks an apostrophe, a non-ASCII letter or an emoji | add those rows before freezing |
| `content-test` | a version from 2 has no content test, it does not load `db-v(N-1)`, or it never reads a value | write it from the example |
| `path-tests` | `migration-paths.test.ts` or `migration-restore-drill.test.ts` missing or gutted | restore it from the templates |
| `every-path` | a pair fails, ends in another schema, loses rows, breaks integrity or foreign keys; the migrations do not load; a `db-vN.sql` is newer than the last listed version, so it is never replayed | fix the pending step; re-freeze its fixture; restore an edited shipped step |
| `restore-drill` | drill A, B or C failed, or crashed | keep the template open path and runner (persistence-and-migrations) |

record-shipped runs the same rules, plus `ref` with `--ref <commit or tag>`: the pending step, its
fixture and `migrations.ts` must be in that ref and equal to the working tree, so the entry hashes what
the build carried.

Expected SKIP: `SKIP src/data/app-database.ts [restore-drill] not yet created
(persistence-and-migrations creates it)`. NOT APPLICABLE when `src/data/migrations/migrations.ts`
does not exist (no expo-sqlite, or preferences only).

## Pitfalls

- **Re-freezing a shipped fixture "because the test fails".** The fixture is what phones hold;
  `shipped-frozen` fails. Fix the step (pending) or add a version (shipped).
- **A pending step edited after its fixture was dumped.** `every-path` reports the schema difference
  against `db-vN.sql`: re-dump the fixture (it has not shipped) and re-record its checksum.
- **Comparing rows with `toEqual` on node:sqlite rows.** Rows have a null prototype; the template
  driver copies them, so `toStrictEqual` works. Keep that driver.
- **Testing a rebuild with foreign keys off in the test.** The device turns them on; load the fixture,
  then `PRAGMA foreign_keys = ON`, as every template does.
- **Running only the new pair.** The matrix is generated from the fixtures folder, so a new fixture
  is covered at once; a hand-written list forgets the skips.

## Limits

- The replay proves the SQL on Node's SQLite, which is newer than the device's: Node 26.4 ships
  SQLite 3.53.2, expo-sqlite 57.0.3 bundles 3.50.3 (`process.versions.sqlite`; `SQLITE_VERSION` in
  `node_modules/expo-sqlite/vendor/sqlite3/sqlite3.h`; checked 2026-10-14). A step that uses a
  function or syntax added after 3.50.3 passes the replay and fails on every phone: keep steps to
  long-standing SQL, and the device proof (release-ritual.md) catches the rest.
- Data moves written in JavaScript inside a step run in Node here and in Hermes on the device; keep
  them to SQL, or cover them by the device upgrade.
- The ledger knows what you recorded. A build that left without `record-shipped` is invisible until
  someone records it: make recording part of the release checklist. Without `--ref`, record-shipped
  hashes the working tree, which is only what shipped if nothing changed since the build.
- The static half of the list check looks for an import of each step's module (`'./v0002-…'`) in
  `migrations.ts`; the exact check (count, order, `version` and `name`) needs the replay, so with
  `--no-replay` a step imported but left out of the array is not seen.
- `restore-snapshot.mjs`'s simulator and emulator modes are self-tested against stand-in `xcrun` and
  `adb` commands that answer from folders (including simctl's exit 3, "found nothing to terminate",
  for an app that is not running, checked on Xcode 26.6 with iOS 26.5). The stand-ins prove the
  order of the steps and the quoting, not a real device's permissions: a full restore on a device was
  not run for this skill.
- `content-test` and `hostile-rows` read source text, so they are heuristics. `content-test` accepts
  any `SELECT` through `driver.get`/`driver.all` that is more than one `COUNT(...)` and is not a
  schema read: a test that selects a value and then never compares it passes, and a `SELECT` built
  in a variable or a helper other than `rowsOf`/`contentOf` is not seen (use those helpers).
  `hostile-rows` looks for an escaped quote inside text (`Mum''s`), a letter outside ASCII and a
  character outside the BMP anywhere on the fixture's INSERT lines; it does not check which column
  holds them. Review the content test and the fixture's rows; the rules only catch the common
  slips.
