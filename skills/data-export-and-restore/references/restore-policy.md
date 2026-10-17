# Restore: the replace policy, the safety copy, the confirmation and what follows

How a checked backup replaces the user's data without ever leaving a half-restored database, and why
this skill restores inside one SQLite transaction instead of swapping database files.

## Contents

1. The policy: replace
2. One transaction, not a file swap
3. The safety copy
4. The confirmation names the policy
5. Tables a backup never holds
6. After the restore
7. Sessions that run in memory
8. Fenced alternatives: merge by id, add as copies

## 1. The policy: replace

`RESTORE_POLICY = 'replace'` (backup-service.ts): the file becomes the whole truth for every backed-up
table. Everything created since the backup is gone, which is exactly what "restore my backup" means on a
new phone or after a reset, and exactly what a user must be told before it runs (section 4).

Replace restores rows **with their ids** (`INSERT INTO lists (id, name, created_at_ms) VALUES (?, ?, ?)`):
references inside the file stay true (a task's `list_id` still names its list), and restoring the same
file twice gives the same rows, not duplicates (the sqlite test "is idempotent"). Ids are SQLite
`INTEGER PRIMARY KEY` row ids here (persistence-and-migrations' schema); with replace that is safe,
because the file's rows are the only rows left. Merge needs stable ids (section 8).

## 2. One transaction, not a file swap

`replaceAll` (sqlite-backup-repository.ts) validates its input with `v.safeParse(BACKUP_PAYLOAD)`, then in
ONE `driver.transaction`: `DELETE FROM tasks`, `DELETE FROM lists` (children before parents), then every
INSERT (parents before children, in the same-file helper `insertRows` called inside the transaction).
`SqlDriver.transaction` runs BEGIN, the work, COMMIT, and on any throw a ROLLBACK and the original error;
the repository converts the error once (`toStorageFailure`) and returns `{ kind: 'storage' }`.

- **All or nothing.** A failure on row 4,000 of 5,000 (a CHECK, a foreign key, a full disk) rolls back
  the DELETEs too: every current row is still there (test: "rolls back whole when a row fails half-way").
  With `journal_mode = WAL` and `synchronous = FULL` (persistence-and-migrations), a kill or power cut
  during the transaction leaves the last committed state; a committed restore survives.
- **Why not stage a new database file and rename it over `app.db`?** In this stack the database is
  opened once, synchronously, in the root layout (`useState(openOnce)`), every repository holds that
  connection, and `AppData` never changes after startup. A swap would have to close that connection
  while screens and stores still hold repositories on it, move `-wal`/`-shm` sidecars correctly, reopen,
  and rebuild `AppData` (a reload). The transaction gives the same guarantee (the old data until the new
  data is complete) with none of that, and rung 7 of the ladder (envelope-and-ladder.md) has already
  proven the file consistent, so the transaction is not expected to fail.
- **Foreign keys stay on.** The live database runs with `foreign_keys = ON`; the replace order respects
  them, so no pragma is needed (and `PRAGMA foreign_keys` is a no-op inside a transaction anyway).
- **Literal statements, protected tables untouched.** Every DELETE and INSERT is written out per table;
  nothing is built from a table list, so a review (and check-backup's `restore-protected` rule) sees that
  `entitlements` and `error_log` are never touched.

## 3. The safety copy

Before `replaceAll`, `restore` (backup-service.ts) reads the current rows, encodes them with the same
envelope, and writes them through `ExportFilesPort.write({ folder: 'private', name:
SAFETY_COPY_NAME })` (`<slug>-before-restore.json` in `Paths.document/backups/`). If that write fails,
the restore returns `safety-copy-failed` and replaces nothing (check-backup: `safety-copy-first`).
The same failure comes back when the encoded current data is larger than `MAX_BACKUP_BYTES`: the copy
could be written, but `previewSafetyCopy` would refuse it as `too-large`, so the undo would be out of
reach. Such data cannot be exported either; the size limit (backup-service.ts) is the one to raise.

Why: the transaction protects against a failed restore, not against a successful restore of the wrong
file ("I picked last year's backup"). The safety copy is the user's undo, and the app has to offer it
itself:

- **The app offers it.** `BackupService.previewSafetyCopy()` reads `SAFETY_COPY_NAME` through
  `ExportFilesPort.readPrivate(name, maxBytes)` and runs the same `readBackup` ladder, returning a
  `RestorePreview` with `source: { kind: 'safety-copy' }` (or `ok(null)` before the first restore).
  The screen shows it as a "Restore the data from before your last restore" row, and the confirmation
  and `restore` are the same as for a picked file (examples/src/features/backup/).
- **A picker cannot reach it.** On Android the system document picker (Storage Access Framework) lists
  document providers, never another app's private `files/` folder, so `files/backups/` is invisible to
  it. On iOS the Files picker shows the app's Documents folder only when the app sets
  `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` (expo-file-system's optional config
  plugin options, platform-behaviour.md section 6), which most apps do not. So "pick it in the restore
  flow" is not a plan; the row above is.
- **One copy.** It is replaced by the next restore (one file, never a growing pile). Restoring the
  safety copy itself writes a new safety copy first, so the undo can be undone. A second, deliberate
  restore of another file replaces it: after restoring file A and then file B, the copy holds A's data,
  and the data from before A is gone (A is still a file the user holds). The confirmation says "A copy
  of your current data is kept" and nothing more. An app whose users restore often can keep the last
  few copies under dated names and sweep the oldest; that is a product choice, not this default.
- **A preview restores once.** `restore` remembers each preview it restored and answers a second call
  with `already-restored`: without it, a double-tapped Replace would write the just-restored data as the
  safety copy and lose the real undo. The model also runs one action at a time (an in-flight ref), so
  the second tap never reaches the service.
- It lives in the documents folder, so device backups (iCloud, Android Auto Backup) carry it too.

## 4. The confirmation names the policy

`pickBackup` returns a `RestorePreview` and writes nothing. The screen shows, in the user's words:

- what the file holds and when it was written (`backup.counts`, `backup.header.exportedAt`, formatted on
  screen in the app's locale, never in the file);
- what it replaces (`current` counts): "Replace your 3 lists and 12 tasks with the 5 lists and 40 tasks
  from the backup of 1 October?";
- the consequence: "Tasks you added since then will be removed. A copy of your current data is kept.";
- rows the database holds but could not read (`currentSkippedRows`, when > 0): "2 items of your current
  data could not be read and will be removed too." They are in neither count and not in the safety
  copy (the repository leaves an unreadable row out of every read), yet `replaceAll` deletes every row
  of the table, so the confirmation is the only place the user can learn of them;
- two buttons: a destructive "Replace" and "Cancel" (the destructive one is never the default focus);
  a second tap on Replace does nothing (section 3).

"Restore" alone reads as "add my backup back" to a user who is about to lose a week. The policy word in
the code (`replace`) and the word on the screen are the same. Only `onConfirmRestore` calls `restore`,
from the press (check-backup: `user-action-only` flags restore, export, share or pick in an effect).

## 5. Tables a backup never holds

`BACKUP_EXCLUDED_TABLES` (backup-schema.ts) lists every user table that is not in the payload, with the
reason; check-backup's `backup-coverage` fails on a table that is in neither list, and `restore-protected`
fails on a protected table (from persistence-and-migrations' `contracts/persistence.json`
`protectedTables`) in the payload or in backup SQL.

- **entitlements (purchases).** A backup is a file the user can open and edit; restoring an entitlement
  row would grant Premium to anyone who types `"is_owned": 1`. A purchase comes back only through the
  store (in-app-purchases: restore purchases), and ends only with a dated revocation.
- **error_log (diagnostics).** This device's history for support, not the user's data.
- **Secrets.** Tokens and keys live in expo-secure-store (auth-and-secure-storage), never in SQLite, and
  never in a backup: a backup leaves the device's protection by design.
- **Preferences** are in the key-value store, not in these tables (envelope-and-ladder.md, section 10).

## 6. After the restore

Every store that holds rows read before the restore is stale. Run the restore through the store layer's
publish-after-write helper, exactly like `resetAllData` (state-management-zustand):
`updateAndPublish(stores, () => backup.restore(preview))` commits the one transaction, then every store
re-reads what is on disk, and a failed restore publishes nothing. An app without such a helper reloads
the JavaScript runtime after a short "Restored" screen instead. Do not keep
showing the old rows: the user would edit data that no longer exists. Report what happened from
`RestoreReport` ("Restored 5 lists and 40 tasks; replaced 3 lists and 12 tasks"), never a bare
"Done".

## 7. Sessions that run in memory

When the database could not be opened (a file from a newer build, a damaged file, a full disk), the
session runs in memory (persistence-and-migrations: `DatabaseStatus.isPersistent === false`). A restore
there would be thrown away at the next start, while the user believes their data is back. `restore`
refuses with `session-in-memory` before writing anything (`BackupServiceDeps.isPersistent`, test:
"refuses to restore into a session that runs in memory"). Export still works and is the most useful
thing such a session can offer.

## 8. Fenced alternatives: merge by id, add as copies

Use only when the product needs them; each changes the data model first.

| Policy | What it does | Needs | The cost the user must be told |
|---|---|---|---|
| Merge by id | upsert per row; a conflict keeps the newer `updated_at_ms` | a stable id minted at creation (UUID or ULID, never a row id that two devices both assign), an `updated_at_ms` written on every change from the `ClockPort`, tombstones for deletes | an edit on this phone can lose to an "older-looking" newer file; clocks across devices disagree, so last-write-wins is approximate |
| Add as copies | inserts every row under new ids | an id map while inserting (children follow their parent's new id) | duplicates by design; the user dedupes by hand |

Each still validates the whole file first, writes the safety copy, and runs in one transaction. A merge
also needs its own frozen fixture pairs ("local rows" + "file rows" → "expected rows") in the round-trip
test.
