# The backup envelope, the validation ladder, upgrades and frozen fixtures

What a backup file is, why each field exists, how a picked file is checked before anything is written,
and how a backup written by an older version still restores after the tables changed.

## Contents

1. Backup is not export
2. The file
3. Canonical JSON and the checksum
4. Two version numbers
5. The validation ladder
6. Text bounds count code points
7. Upgrading an older backup
8. Adding schema version N+1, in order
9. Frozen fixtures and the hostile data they hold
10. Decisions and the alternatives not taken

## 1. Backup is not export

| | Backup | Export (CSV, a report) |
|---|---|---|
| Reader | this app, later, maybe on another phone | a person, a spreadsheet, another tool |
| Fidelity | exact: every row, its id, its canonical values | lossy by design: joined, labelled, formatted |
| Restorable | the only thing restore accepts | never: restore refuses it as `not-a-backup` |
| Format | the envelope below (JSON) | CSV through the guarded encoder (csv-and-formats.md) |

The moment a CSV becomes restorable, a format built to be read becomes the file somebody's records
depend on: no versions, no types, no checksum. Keep the two features, their buttons and their code paths
apart; a CSV that a user picks for restore fails at rung 2 with a message that says so.

## 2. The file

```json
{
  "format": "tasks.backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "2.3.0",
  "exportedAt": "2026-10-10T08:00:00.000Z",
  "payloadSha256": "4b296faa950a9b0902ff4b60c9f0fb52c66e3f32d77877ec171e2e7ce5307495",
  "payload": { "lists": [ ... ], "tasks": [ ... ] }
}
```

`encodeBackup` (templates/src/data/backup/backup-envelope.ts) writes it on one line:
`${JSON.stringify(header).slice(0, -1)},"payload":${canonicalJson(payload)}}`.

| Field | Why it is there |
|---|---|
| `format` | "this is a backup of this app": a JSON file of another app, or any random JSON, is refused at once. Set it once (`<app-slug>.backup`) and never change it |
| `formatVersion` | the envelope's own shape. A newer one is refused as `newer-format` before its header is parsed, because a newer header may have other fields |
| `schemaVersion` | the database version the rows were read from (`LATEST_DB_VERSION`). Newer than the build: `newer-version`; older: upgraded (section 7) |
| `appVersion` | provenance for support ("written by 2.3.0"); the refusal message can name the version to update to. Never a compatibility check: versions and builds do not map to schemas |
| `exportedAt` | an ISO-8601 UTC instant with `Z` from the `ClockPort`, shown in the confirmation ("the backup of 1 Oct") |
| `payloadSha256` | SHA-256 of the canonical payload text: catches truncation, a damaged download, a hand edit |
| `payload` | one array per backed-up table, rows ordered by id, column names and values exactly as the table holds them |

**Header first.** A reader (and a person who opens the file) sees what the file is before any payload,
and a truncated file still begins with `{"format":"tasks.backup"`: `checkEnvelope` uses that to report
a cut-off file of ours as `damaged`, not as `not-a-backup` (the message differs: "damaged" tells the
user their file is ours but broken).

**Payload = the tables' rows.** Integer ids, `created_at_ms` epoch milliseconds, `is_done` 0/1, TEXT as
stored. The restore inserts them with their ids, so references inside the file stay true and restoring
the same file twice gives the same rows (idempotent, no duplicates).

## 3. Canonical JSON and the checksum

`canonicalJson` (src/core/portable/canonical-json.ts): object keys sorted by UTF-16 code units at every
depth, arrays in order, strings and numbers exactly as `JSON.stringify` writes them, no whitespace; a
non-finite number throws (JSON.stringify would silently write `null`). `sha256Hex`
(src/core/portable/sha256.ts) hashes the UTF-8 bytes (a lone surrogate becomes U+FFFD, as TextEncoder
and Node's `'utf8'` do).

- **The checksum is over the canonical text, not the file's bytes.** Reading re-canonicalizes the parsed
  payload and hashes that, so a file reformatted by an editor, a pretty-printer or Prettier (the frozen
  fixtures are pretty-printed) still verifies, while any changed value does not.
- **Same data, same bytes.** Rows are read `ORDER BY id`, keys are sorted: export, restore, export again
  gives a byte-identical file (the round-trip test asserts `toBe`, not a fuzzy compare).
- **Pure TypeScript SHA-256 on purpose.** It runs synchronously in Hermes, Jest and Node with no native
  module and no mock; Node's `createHash('sha256').update(text, 'utf8')` gives the same value, so
  `scripts/inspect-backup.mjs` verifies a user's file on a computer. Correctness: test vectors (FIPS 180-4
  examples, padding boundaries 55/56/64 bytes, UTF-8, a lone surrogate) and a 3.3 MB payload, all
  compared with node:crypto on 2026-10-10. Speed, measured the same day on that payload: 26 MB/s in
  Node 26 with its JIT, 1.6 MB/s with `--jitless` (an interpreter, a rough stand-in for Hermes; not
  measured on a device). Export, preview and the safety copy each hash once, on the JS thread, so the
  screen shows a busy state first and starts the work on the next frame (examples/src/features/backup/
  use-backup-model.ts), and `MAX_BACKUP_BYTES` stays at 16 MB until the app measures its largest
  realistic backup on a low-end Android phone. Above that, section 10.
- **Not a signature.** Anyone can recompute it. It detects accidents and hand edits; it does not prove
  who wrote the file. The safety of restore never rests on it: every row is validated anyway (rung 6),
  and protected tables are never in a backup (restore-policy.md).

## 4. Two version numbers

`formatVersion` (the envelope) and `schemaVersion` (the rows) change for different reasons: a header
field can be added without a database migration, and a column can be added without touching the header.
One "version" would force a false choice on the next change. `BACKUP_SCHEMA_VERSION = LATEST_DB_VERSION`
(never a literal: the literal stays behind at the next migration and new files then claim an old schema;
check-backup's `schema-version` rule). `FIRST_BACKUP_SCHEMA_VERSION` is the database version of the first
release that wrote backups; it never changes after that release. An app that adopts backups when its
database is already at version N sets it to N (the template's `1` fits only a database still at 1):
check-backup then expects upgrade steps N+1 onwards and fixtures `backup-vN.json` onwards, and no file
from before N can exist, so none is ever made up (a file claiming an older schema fails as `too-old`).

## 5. The validation ladder

Cheapest first; nothing below a rung runs until it passes, and nothing at all is written until the user
confirmed the preview. Each rung has its own failure kind (backup-failures.ts) and message
(examples/src/features/backup/backup-failure-messages.ts).

| Rung | Check | Failure kind | Where |
|---|---|---|---|
| 0 | the picked file is at most `MAX_BACKUP_BYTES` (16 MB) | `too-large` | backup-service.ts from the picker's size; ExportFilesPort.readText from the size on disk when the picker gives none; both before reading it into memory |
| 1 | the file can be read | `unreadable` | ExportFilesPort.readText |
| 1 | not empty, parses as JSON | `not-a-backup` (or `damaged` when it starts with our header) | checkEnvelope |
| 2 | `format` is ours; `formatVersion` not newer | `not-a-backup`, `newer-format` | checkEnvelope |
| 3 | the strict header: every field of its shape, no unknown key | `damaged` | checkEnvelope (valibot `BACKUP_HEADER`) |
| 4 | `payloadSha256` matches the canonical payload, **before any row is read** | `damaged` | checkEnvelope |
| 5 | `schemaVersion` not newer than the build, not older than the first backup version | `newer-version`, `too-old` | checkEnvelope |
| 6 | the payload, upgraded when older, matches the row schemas (strict, code-point bounds) | `invalid-row` with the path (`tasks.3.title`) | readBackup |
| 7 | ids unique per table, every child's parent in the file | `inconsistent` (table, id, reason) | readBackup |
| 8 | the current data was copied to the safety file | `safety-copy-failed` | backup-service.ts restore |
| 9 | the one replace transaction committed | `storage` (rolled back) | the SQLite backup repository |

Why the checksum comes before the rows: a truncated or edited file otherwise fails "somewhere in the
rows" and is reported as a broken row, which sends the user looking for a data problem instead of a
damaged file. Why rung 7 exists although the database has foreign keys: the replace would fail on the
first orphan anyway (and roll back), but only rung 7 can name the row before the confirmation.

**Never trust the name or the MIME type.** Providers label the same `.json` file `application/json`,
`application/octet-stream` or `text/plain`; the picker opens with `*/*` and the envelope decides. A file
named `backup.json` that holds a CSV fails rung 1; a file named `notes.txt` that holds a valid backup
restores.

**There is no partial success.** A report that says "412 of 500 rows restored" means the ladder let
broken rows through. Either every rung passed and the transaction committed, or nothing changed.

## 6. Text bounds count code points

SQLite's `length()` counts characters (code points) for TEXT; JavaScript's `.length` counts UTF-16 units,
so a 200-emoji title is 200 to the CHECK constraint and 400 to `v.maxLength(200)`. A backup schema built
with `v.maxLength` refuses rows the database legally holds: the user can export but never restore.
`backup-schema.ts` builds its bounds with `codePoints(min, max)` (`Array.from(text).length`), and the
frozen fixture holds a 200-emoji title to keep it that way. The backup schemas also never trim or
normalize: a whitespace-only title the table holds is restored as it is (the input schemas of the
repository may trim new input; a backup restores old data exactly).

## 7. Upgrading an older backup

A backup written at schema 3 is restored by a build at schema 5 through `BACKUP_UPGRADES`
(backup-upgrades.ts): one frozen, pure step per migration after `FIRST_BACKUP_SCHEMA_VERSION`, each in
`src/data/backup/upgrades/vNNNN-<name>.ts`, doing to the JSON rows exactly what migration `vNNNN` does to
the tables (an `ADD COLUMN` gets its default, a rename its new name, a split table its two arrays). The
upgraded payload then meets the latest row schemas at rung 6.

- **Frozen like the migration.** Literal table and column names, no import but the `BackupUpgrade` type
  and `mapRows` (backup-upgrade-step.ts), no clock, no randomness. Tomorrow's constant must not change
  yesterday's upgrade.
- **Proven equal to the migration.** The parity test (test/sqlite/backup-round-trip.test.ts) takes every
  frozen backup older than the latest schema, inserts its rows into a database at that old version
  (test-only SQL built from the column names), runs the real migrations, reads the rows back, and
  compares them with what the JSON steps produced. A step that gives the new column `''` where the
  migration gives `NULL` fails here (proved on the v2 example on 2026-10-10).
- **Why not restore through the migrations directly?** That needs SQL built from the file's column
  names in app code (a staging database at the old version), which the data layer's bound-parameter rule
  forbids for good reasons; and every restore would pay for a full migration run. The JSON steps are
  small, and the parity test removes the risk of two paths drifting apart.

The whole worked example: examples/backup-v2/ (migration v0002 adds `tasks.due_on`; the step, the schema,
the repository's SELECT/INSERT, the frozen `backup-v2.json`, and FIXTURES with both versions).

## 8. Adding schema version N+1, in order

Done in the same change as migration N+1 (persistence-and-migrations, "Adding version N+1"):

1. Before anything else, if version N shipped with backups and has no fixture yet: export a backup with
   the version-N build and commit it as `src/data/backup/fixtures/backup-vN.json`. It is what users hold.
2. Write `src/data/backup/upgrades/v000(N+1)-<name>.ts`: the JSON twin of the migration. Append it to
   `BACKUP_UPGRADES`.
3. Change `backup-schema.ts` (the row schema of the changed table, or a new table in `BACKUP_PAYLOAD`, or
   a new entry in `BACKUP_EXCLUDED_TABLES` with its reason) and the SQLite backup repository's SELECT and
   INSERT for that table (and `insertRows`, children after parents; DELETE children before parents).
   Update the row literals in the backup tests (the new column; the v2 example's copy of the template
   tests compiles only after that).
4. Make a new fixture `backup-v(N+1).json` with the new build (`encodeBackup` over the hostile rows plus a
   value in the new column) and add `{ name: 'backup-v(N+1)', version: N + 1 }` to FIXTURES.
5. Run `npx jest src/data/backup src/core/portable test/sqlite --ci`: the parity test now runs for every
   older fixture.
6. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-backup.mjs .`: `upgrade-chain`, `backup-coverage` and
   `backup-fixture` name anything forgotten.

## 9. Frozen fixtures and the hostile data they hold

`src/data/backup/fixtures/backup-vN.json` is a file version N of the app wrote. Never edit one: its
`payloadSha256` stops matching (check-backup's `backup-fixture` rule and the round-trip test both fail).
A changed fixture is a reviewed change (a Gate-Change trailer, quality-gates). Every fixture holds the
data that breaks naive code, because `'test1'` survives everything and proves nothing:

| Row value | What it catches |
|---|---|
| `Call the plumber about the kitchen's tap`, `Work, "Q4"` | quoting in CSV, escaping in SQL |
| `=1+2`, `@SUM(A1:A2)` | CSV formula injection |
| `line one\r\nline two, "quoted"` | CRLF inside a field, a trimming writer |
| `‏شراء الحليب‏`, a list named `‏البيت‏` | RTL text with bidi marks kept byte for byte (never "cleaned up") |
| `Send the report 📊`, a 200-emoji title | astral characters, code-point bounds (section 6) |
| `'   '` (whitespace only) | a schema that trims or a writer that drops blanks |
| `created_at_ms: 0`, `4102444800000` (2100-01-01) | the epoch and a far-future instant in both formats |
| ids 1-7 then 9 (a gap) | code that renumbers rows |

## 10. Decisions and the alternatives not taken

- **JSON, not a copy of the SQLite file.** A database file carries other tables (entitlements, the error
  log), indexes and free pages, ties restore to an exact schema with no per-row validation, and needs a
  WAL-safe copy plus a file swap while the app holds the connection. A JSON payload of chosen tables is
  validated row by row and upgraded across versions. (An app with very large data can still offer a
  file-level backup; it is a separate feature with its own risks, not this skill's default.)
- **Synchronous, in memory, with a budget.** The database is read synchronously (expo-sqlite through
  `SqlDriver`), the file is built as one string and written once. For user-entered data this is a few MB
  at most. **Export and restore share the one limit**: `exportBackup` refuses with `too-large` (and
  publishes nothing) when the encoded file is over `MAX_BACKUP_BYTES`, because a backup the app would
  later refuse to restore, typically on a new phone, is worse than no backup and an honest message.
  It also refuses a snapshot that would fail rung 7 (`inconsistent`), after `readAll` has left out the
  children of rows it could not read. CSV exports have no such limit (nothing restores them). Above
  `MAX_BACKUP_BYTES` (16 MB; adjust only after measuring) the design changes: a native
  digest behind a port (expo-crypto 57's `digest(algorithm, data)` is async and native), a streaming
  writer (`File.open()` with `FileHandle.writeBytes`, or `File.writableStream()`, both in expo-file-system
  57) and a page-by-page reader. That is a deliberate redesign, not a tweak.
- **No encryption by default.** A backup is plain JSON; the confirmation and any store copy must not
  claim otherwise (privacy-and-store-declarations). Encrypting with a passphrase is possible (a KDF and
  AES-GCM from a vetted library); a forgotten passphrase then loses the backup, so it is a product
  decision. Secrets (tokens in expo-secure-store, auth-and-secure-storage) are never part of a backup.
- **Preferences stay out by default.** Settings live in the key-value store (settings-and-preferences)
  and are device choices. An app that wants them in the backup adds a `settings` section validated by the
  settings codec, and restores it through the settings store, not through SQL.
- **Apps on the save-document appendix** (persistence-and-migrations, `"mode": "document"` or `"both"`):
  the document's sections are the payload instead of (or next to) table rows, `schemaVersion` is the
  document's `LATEST_*` version, its frozen document steps are the upgrade path (no second set of
  steps), protected sections stay out exactly like protected tables, and the restore writes through the
  document service's single writer (validated, both slots in one transaction), never around it.
