# Tests that must exist, and what check-backup and inspect-backup report

The test recipes that prove export and restore, and each rule of the checker with what to change when it
fails.

## Contents

1. The tests the templates ship
2. Hostile data and refusals
3. Running them
4. check-backup: rules and fixes
5. Configuration and applicability
6. inspect-backup
7. Limits of the static checks

## 1. The tests the templates ship

| Test | Proves | Runs on |
|---|---|---|
| `src/core/portable/sha256.test.ts` | SHA-256 equals node:crypto (FIPS vectors, padding boundaries, UTF-8, lone surrogate) | Jest |
| `src/core/portable/canonical-json.test.ts` | sorted keys, hostile strings exact, NaN refused | Jest |
| `src/core/portable/csv.test.ts` | both escapes, BOM, CRLF, a strict RFC 4180 reader round trip | Jest |
| `src/data/backup/backup-envelope.test.ts` | header order, stamps, every envelope refusal (empty, CSV, foreign JSON, truncated, one changed byte, naive time, newer format, newer schema), a pretty-printed file still verifies | Jest |
| `src/data/backup/read-backup.test.ts` | the frozen hostile fixture reads; code-point bounds; `invalid-row` names the path; `inconsistent` (duplicate id, missing parent) | Jest |
| `src/data/backup/backup-upgrades.test.ts` | one step per version; steps applied in order, pure; a missing step reported | Jest |
| `src/data/backup/tasks-csv.test.ts` | the CSV of the fixture: codes, formulas neutralized, CRLF kept, canonical values | Jest |
| `src/data/backup/backup-service.test.ts` | export publishes and sweeps; a failed write leaves nothing; a backup over the limit or failing rung 7 is refused and publishes nothing (CSV is not limited); share passes types and anchor; preview writes nothing; safety copy first; no replace when it fails; in-memory session refused; typed failures for cancel, unreadable, CSV, too large (from the picker's size and from the size on disk); a preview restores once; `previewSafetyCopy` is null before a restore, brings the old data back after one, and refuses a damaged copy | Jest, fakes |
| `test/sqlite/sqlite-backup-repository.test.ts` | real SQL from the frozen `db-v1.sql`: excluded tables never read or written, idempotent replace, whole rollback on a failing row, schema refusal before any write, unreadable rows counted and logged without their text, the tasks of an unreadable list left out so the snapshot stays consistent | node:sqlite |
| `test/sqlite/backup-round-trip.test.ts` | export, restore into an empty database, export again: the same bytes; every frozen backup restores; every older fixture's upgrade equals the migrations' (parity) | node:sqlite |
| fakes' tests (`fake-export-files`, `fake-share-sheet`, `fake-file-picker`, `fake-backup-repository`) | the contract each adapter keeps | Jest |

The service test runs entirely on fakes (`createFakeBackupRepository`, `createFakeExportFiles`,
`createFakeShareSheet`, `createFakeFilePicker`, `createFakeClock`): no `jest.mock` of the app's own
modules (unit-and-component-tests). The SQL tests use the canonical node:sqlite driver with foreign keys
off until the app's pragma, as on a device (persistence-and-migrations).

## 2. Hostile data and refusals

- The frozen fixture's rows (envelope-and-ladder.md, section 9) are the minimum. A new column gets a
  hostile value in the next fixture (an empty string next to a null, the largest value its CHECK allows).
- **Every refusal is a test that also asserts nothing changed**: `replaceCount()` stays 0 and the private
  folder stays empty (service test), or the rows equal the rows before (SQL test).
- **Failure leaves no artifact**: `failNextWrite` on the fake, then the share folder is empty. The real
  adapter's temp-and-move is read by check-backup (`atomic-write`) and covered by the drill.
- **Idempotent restore**: the same payload twice gives the same rows.
- **Byte identity, not "looks the same"**: the round-trip test compares the two exports with `toBe`.

## 3. Running them

```sh
npx jest src/core/portable src/data/backup src/services/export-files src/services/share-sheet src/services/file-picker test/sqlite --ci
npm run typecheck
node ${CLAUDE_SKILL_DIR}/scripts/check-backup.mjs .
```

## 4. check-backup: rules and fixes

`node ${CLAUDE_SKILL_DIR}/scripts/check-backup.mjs [repo-root] [--backup-dir <dir>] [--json]`. Each
problem line is `FAIL <file>:<line> [<rule>] <message> Fix: <fix>`.

| Rule | Reports | Fix |
|---|---|---|
| `envelope-header` | `encodeBackup` missing, header keys not `format, formatVersion, schemaVersion, appVersion, exportedAt, payloadSha256` in order, payload not appended last, no checksum written | the template's `encodeBackup` |
| `schema-version` | `BACKUP_SCHEMA_VERSION` missing or not derived from `LATEST_DB_VERSION` | `= LATEST_DB_VERSION` |
| `checksum-first` | nothing compares `payloadSha256`; a reader parses `BACKUP_PAYLOAD` (`v.safeParse` or `v.parse`) before calling the envelope check or `readBackup`, in the backup folder or in a runtime file that imports from it | compare in `checkEnvelope`; call it first in `readBackup`; elsewhere call `readBackup` |
| `newer-refused` | no `schemaVersion > BACKUP_SCHEMA_VERSION` refusal returning `newer-version` | the template's `versionFailure` |
| `typed-failures` | a `throw` in backup code; no `RestoreFailure`; a required kind missing (`not-a-backup`, `damaged`, `newer-version`, `invalid-row`, `inconsistent`, `storage`) | return `err({ kind })`; one kind per reason |
| `restore-transaction` | a DELETE or INSERT of the SQLite backup repository outside a transaction, or the INSERTs in another transaction than the DELETEs (a same-file helper called inside the transaction counts) | one `driver.transaction` around all of it |
| `restore-protected` | backup SQL touching a protected table; a protected table in `BACKUP_PAYLOAD` or missing from `BACKUP_EXCLUDED_TABLES` | leave it out, list it with its reason |
| `backup-coverage` | no `BACKUP_PAYLOAD`; a migrated table neither backed up nor excluded; a payload key that is not a table | add the table to the payload (and readAll, replaceAll, the fixture) or exclude it |
| `upgrade-chain` | a migration after the first backup version without an upgrade step, or a step without a migration | the JSON twin of the migration, in `BACKUP_UPGRADES` |
| `backup-fixture` | a schema version without `fixtures/backup-vN.json`; a fixture that is damaged (checksum), of another format, or declares another version; a fixture missing from the round-trip test's FIXTURES | export with that version; never hand-edit; list it |
| `round-trip-test` | no test restores (`replaceAll`) what it read or encoded through the SQLite backup repository | the template's `backup-round-trip.test.ts` |
| `safety-copy-first` | a function (in the backup folder or a runtime file importing from it) calls `.replaceAll(x)` with one non-string argument without first writing the private safety copy and returning when that fails | the template's `restore`; elsewhere call `BackupService.restore` |
| `atomic-write` | a file that writes with expo-file-system (or `expo-file-system/legacy`: `writeAsStringAsync`, `moveAsync`, `deleteAsync`) without a temp file moved into place, or without discarding the temp file on the failure path (a catch, an `if (!x.ok)` branch, or a helper called there) | the template adapter's `writeAtomically` |
| `sdk-behind-port` | expo-sharing, expo-document-picker or expo-file-system imported outside an adapter file | use the ports |
| `user-action-only` | `exportBackup`, `exportCsv`, `pickBackup`, `shareFile`, `pickFile`, `shareAsync`, `getDocumentAsync` or `Share.share` inside an effect, timer or app-state listener | call it from the press handler |
| `csv-guard` | the encoder misses a formula leader or does not double quotes | the template's `csv.ts` |
| `csv-hand-rolled` | a file that writes CSV (a `.csv` name, or `text/csv` that is not a `type:` picker filter) builds rows itself (`.join(',')`, `;` or tab, or a template literal with `,` between substitutions) without importing the encoder directly or through a module that imports it; or there is no guarded encoder | `toCsv` |
| `canonical-values` | localized formatting or i18n imports in backup code or the CSV encoder | canonical values; localize on screen |

Expected SKIP lines (only before the database layer exists):
`SKIP src/data/migrations [upgrade-chain] not yet created (persistence-and-migrations creates it)` and
the same for `[backup-fixture]`.

## 5. Configuration and applicability

- Paths come from the layout (`src/`, `src/data/`, `src/services/`, `test/`, `contracts/`, overridable in
  `rn-skills.config.json`). This skill reads one extra key: `"backupDir"` (default `<dataDir>/backup`),
  also `--backup-dir`.
- Protected tables come from `contracts/persistence.json` `protectedTables`; without that contract the
  checker assumes `entitlements` and `error_log`.
- The backup module files are found by what they define (`encodeBackup`, `BACKUP_PAYLOAD`, a
  `sqlite-*-repository.ts` in the backup folder, the reader that parses `BACKUP_PAYLOAD`), so a renamed
  file is still checked.
- **NOT APPLICABLE** when the app has no backup folder and no source file imports expo-sharing or
  expo-document-picker or writes `text/csv`. With no backup folder but such a file, only the whole-src
  rules run and a `note:` line says so.
- Installed skills (`.agents/skills/`, `skills/`, any folder holding a `SKILL.md`) are never scanned.

## 6. inspect-backup

`node ${CLAUDE_SKILL_DIR}/scripts/inspect-backup.mjs <file> [--format <app>.backup] [--schema <N>]
[--format-version <N>] [--json]` runs the envelope rungs in Node on a file on the computer (a user's file
for support, a frozen fixture, a file copied off a simulator) and prints `header: ...` and `rows: ...`.
A refusal is one `FAIL <file>:1 [backup-envelope] <kind>: <detail>` with the same kind the app would
return; `--schema` makes a newer file fail as `newer-version`. It writes nothing.

## 7. Limits of the static checks

The checker reads source text; it does not run the code. It cannot prove that the confirmation's words
match the policy, that the stores re-read after a restore, that the screen offers the safety copy, that
a step really mirrors its migration (the parity test does), or that the adapters behave on a device (the
drill does). It finds the functions it checks by name (`encodeBackup`, `checkEnvelope`, `readBackup`,
`replaceAll`, `BACKUP_PAYLOAD`, `BACKUP_UPGRADES`): an app that renames them keeps the names or adapts
this skill. The heuristic rules have known gaps, kept on purpose rather than grown into fragile
patterns; review covers them:

- `csv-hand-rolled` sees a CSV writer only by a `.csv` literal or a `text/csv` type, and a hand-built row
  only as a `.join` with a literal separator or a template literal with `,` (or `;`, `\t`) between
  substitutions. Rows built by `+` concatenation, a separator held in a variable, or a file name built
  without a `.csv` literal pass. A file that imports anything from the encoder (or from a module that
  does, even only `CSV_MIME_TYPE`) counts as an encoder user and may still hand-build another CSV
  (`${row.name},${String(row.total)}` written to `orders-<day>.csv` passes). Tracing which imported
  function builds the rows would need call-graph analysis; review the CSV writers by hand.
- `atomic-write` knows the object API and the legacy API by name (`.write`, `writeAsStringAsync`;
  `moveSync`, `move`, `rename`, `moveAsync`; `delete`, `deleteAsync`). A write through another library
  (react-native-fs, a native module) is not seen; `sdk-behind-port` does not list those either.
- `safety-copy-first` and `checksum-first` run on the backup folder and on runtime files that import
  from it (value imports, resolved through the tsconfig aliases). A restore that reaches the tables
  without importing anything from the backup folder (raw SQL `DELETE`s in a feature) is
  `restore-protected`'s and the review's to catch. The safety copy counts when a `files.write({ folder:
  'private', ... })` or a call to a function named `*safety*` precedes the replace and a `return` follows
  it; a copy written to the wrong folder by a helper with that name passes.
- `user-action-only` looks for the outward calls inside `useEffect`, timers and app-state listeners by
  name; a call hidden behind a helper the effect calls is not seen.
