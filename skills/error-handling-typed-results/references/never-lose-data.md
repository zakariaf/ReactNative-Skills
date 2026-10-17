# Never losing the user's data on an error path

Most data loss in a mobile app is not a crash: it is an error path that "recovers" by destroying data, or
a failure nobody showed. This file covers the error-handling side; transactions, migrations, newer-file
handling and the kill test belong to persistence-and-migrations, backups and restore to
data-export-and-restore, and the ritual of shipping a schema step to run-migration.

## Contents

1. The four ways an error path loses data
2. Never destroy on an error path
3. Keep the user's input until the write succeeded
4. A bad record is quarantined, not deleted
5. Newer data than the app knows: read-only, never reset
6. Every failed user write is visible
7. Test recipes
8. What the checker sees, and what it cannot

## 1. The four ways an error path loses data

| Path | Example | Rule |
|---|---|---|
| Destructive recovery | `catch { deleteDatabaseSync('app.db'); }` "to start fresh" | section 2 |
| Input cleared before success | the form resets on submit; the save fails; the text is gone | section 3 |
| One bad row takes everything | a row fails validation, the loader throws, the app shows an empty list and the next save overwrites the table | section 4 |
| Silent failure | a save rejects inside a fire-and-forget call; the user believes it was stored | section 6 |

## 2. Never destroy on an error path

An error path never deletes, drops, clears, truncates or resets data the user may still need: no
`deleteDatabaseSync`, `DROP TABLE`, `DELETE FROM`, `TRUNCATE`, `.clear()`, `removeItem`,
`deleteItemAsync`, file `delete()`, `reset*()`, `wipe*()` or `purge*()` inside a `catch`, a `.catch`
handler or a failure branch (`if (!result.ok)`). "Reset on error" turns a recoverable read failure (a
locked database, a disk briefly full, a migration bug fixed in the next release) into permanent loss.

What to do instead:

- **A read failed:** show the failure with a retry and keep everything on disk; record the raw error.
- **The database cannot be opened:** open it read-only if possible, otherwise run with an empty in-memory
  state and write nothing, so the next release can still read the file.
- **A real reset** (the user asked for "Delete all data") is a user action with a confirmation or an Undo,
  never an automatic recovery (settings-and-preferences and ui-states-and-feedback own that flow).

`check-error-spine` reports each destructive call it finds on an error path (`no-destructive-recovery`).

## 3. Keep the user's input until the write succeeded

The model hook clears a form only after the repository returned `ok`; on a failure the input stays in the
field and the failure becomes a message with a retry: `examples/tasks/use-add-task-model.ts` and its test.

- Never `reset()` a react-hook-form form, clear a draft or navigate away before the write resolved.
- A failure keeps the screen where the user is; a success may navigate.
- Long input (a note, a description) also survives process death through a debounced draft
  (forms-and-input owns drafts); the error path's job is only to never throw the draft away.

## 4. A bad record is quarantined, not deleted

When one row or document cannot be parsed or migrated, the loader:

1. moves (copies, then removes in one transaction) that row into a quarantine table with the reason and
   the time, keeping at most N recent quarantined rows;
2. records the reason through the error log;
3. returns the rest of the data as a successful load, with an outcome the screen may mention
   (`{ kind: 'loaded-with-quarantine', count }`).

Losing one task is bad; losing all tasks because one was malformed is the bug this prevents. The
save-document appendix of persistence-and-migrations implements the same idea for a single JSON document
(current, backup, quarantine).

## 5. Newer data than the app knows: read-only, never reset

A database or document whose schema version is newer than the running app (a downgrade, an older test
build, a restored backup from a newer device) is not damaged. The app:

- never migrates it down and never resets it;
- leaves the file as it is, runs this session from an in-memory state (or reads the file read-only), and
  writes nothing to it;
- shows an "update the app" message with the version it found.

Treating "newer" as "corrupt" deletes everything the newer version wrote. persistence-and-migrations owns
the version check and the newer-file outcome (its rule: never touch a file the build cannot use); the
error-handling rule is that this outcome is a typed failure the first screen shows, never a reset.

## 6. Every failed user write is visible

- A user-initiated write returns a `Result`, and the model hook turns a failure into a message
  (`taskFailureMessage`). It is never fire-and-forget.
- A background write (an autosave, a sync) that fails records the error and marks the item as not saved
  (a typed state the UI can show), so a later retry knows what to send.
- A store publishes a change only after it was persisted (state-management-zustand's persist-before-
  publish rule), so the screen never shows data that is not on disk.

## 7. Test recipes

- **Input survives a failed write:** a fake repository returns `err({ kind: 'storage-full' })`; after
  `add()`, the title is still in the model and the failure message key is set
  (`examples/tasks/use-add-task-model.test.ts`).
- **Only success clears:** the same fake returns `ok(task)`; the title is empty afterwards.
- **No destructive recovery:** a repository test drives the failure path on real `node:sqlite` (a
  constraint violation, a closed database) and asserts the table still holds every row afterwards.
- **Quarantine:** insert one malformed row among valid ones; the load returns the valid ones, the
  quarantine table holds the bad one, and the error log has one entry.
- **Newer version:** a fixture database with `PRAGMA user_version` one above the app's; opening it
  returns the read-only outcome and no write happens (count rows before and after).

## 8. What the checker sees, and what it cannot

`no-destructive-recovery` looks inside catch blocks, `.catch` handlers and `if (!x.ok)` / `x.ok === false`
/ `else` branches of `if (x.ok)`. It cannot see a destructive call made by a function the error path
calls (`handleCorruption()` that drops a table), a reset after a failure flag was set elsewhere, or a
failure that is never shown. The tests above and review cover those. When the checker flags a call that
is genuinely correct (a cache of derived data, not user data), move it out of the error path into a
named function the code calls on purpose, so the reason is visible.
