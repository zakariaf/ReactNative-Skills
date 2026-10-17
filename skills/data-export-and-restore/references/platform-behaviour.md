# Files, the share sheet and the picker on iOS and Android (Expo SDK 57)

The three ports, their adapters, the APIs they call (read in the SDK 57 type declarations and docs on
2026-10-10), how each platform behaves, and the manual drill that covers the device-only adapters.

## Contents

1. The three ports and why three
2. Versions and installation
3. ExportFilesPort over expo-file-system
4. ShareSheetPort over expo-sharing
5. FilePickerPort over expo-document-picker
6. Folders, device backups and cleanup
7. Wiring: classification and composition
8. The export-share-restore drill (named devices)
9. Not covered here

## 1. The three ports and why three

| Port | Adapter (the only importer of its SDK) | Fake (with its own test) |
|---|---|---|
| `ExportFilesPort` (write atomically, sweep, read a picked file or the safety copy, size first) | `expo-file-system-export-files-adapter.ts` | `fake-export-files.ts` |
| `ShareSheetPort` (hand one file to the system sheet) | `expo-sharing-share-sheet-adapter.ts` | `fake-share-sheet.ts` |
| `FilePickerPort` (pick one file, copied into the cache) | `expo-document-picker-file-picker-adapter.ts` | `fake-file-picker.ts` |

One SDK per adapter keeps the `<library>-<concern>-adapter.ts` name honest (architecture-and-boundaries),
and each fake states the contract its adapter must keep. Every method returns a `Result` (or
`Promise<Result>`) and never throws or rejects: the service and the screen handle typed values only.
The adapters are device-only (`// device-only: covered by ...` in their first lines, so coverage leaves
them out); the drill in section 8 is what covers them.

## 2. Versions and installation

```sh
npx expo install expo-file-system expo-sharing expo-document-picker
```

SDK 57 ranges (Expo's bundled native modules): `expo-file-system ~57.0.7`, `expo-sharing ~57.0.22`,
`expo-document-picker ~57.0.3`; installed and type-checked in an SDK 57 app on 2026-10-10. Re-verify:
`npx expo install --check` and `npm view expo-sharing@~57.0.22 version`. None needs a config plugin for
what this skill does (sharing a file out and picking a file in); `expo-file-system/legacy` is not used
(the main entry's old functions throw at runtime in SDK 57, per the docs).

## 3. ExportFilesPort over expo-file-system

APIs used (expo-file-system 57, the object API): `new Directory(Paths.cache | Paths.document, 'exports')`,
`directory.exists`, `directory.create({ intermediates: true })`, `directory.list()`, `new File(dir, name)`,
`file.create({ overwrite: true })`, `file.write(text)` (UTF-8 by default, synchronous), `file.moveSync(
target, { overwrite: true })`, `file.delete()`, `file.exists`, `file.size` (bytes; 0 when the file does
not exist or cannot be read), `new File(uri).text()` (async), `Paths.availableDiskSpace` (bytes).

- **Atomic publish.** `write` writes `.<name>.partial` in the same folder, then `moveSync`s it over the
  published name; on any throw the partial file is deleted and the throw becomes `write-failed`. No
  half-written file ever carries the name the share sheet or a restore would trust (a truncated "backup"
  is the failure that surfaces months later). Same-folder moves are renames on both platforms' file
  systems. check-backup's `atomic-write` rule reads this.
- **Space first.** `write` refuses with `no-space` when `Paths.availableDiskSpace` is below the file's
  UTF-8 size plus a 5 MB margin, so an export never fills the disk the database needs.
- **Plain names only.** `^[A-Za-z0-9._-]{1,120}$`: no path separators, no surprises in another app's
  file list. Names carry the local date from `ClockPort.today()` (`tasks-backup-2026-10-10.json`).
- **Reading a picked file** uses the cache copy the picker made (`file://`), with the async `text()`, so
  a large file does not block the JS thread while it is read (hashing and parsing still run on it).
  `readText(uri, maxBytes)` reads `file.size` first and answers `too-large` without reading when it is
  over the limit: the picker's `size` is optional, so the service's own check cannot always run.
- **Reading the safety copy.** `readPrivate(name, maxBytes)` reads one file of `Paths.document/backups/`
  by plain name with the same size check, and answers `ok(null)` when it does not exist (no restore has
  run yet). It is how the app offers the undo of the last restore (restore-policy.md, section 3).

## 4. ShareSheetPort over expo-sharing

`isAvailableAsync()` then `shareAsync(uri, { mimeType, UTI, dialogTitle, anchor })` (expo-sharing 57):

| Option | Platform | Value here |
|---|---|---|
| `mimeType` | Android (the intent's type) | `application/json`, `text/csv` |
| `UTI` | iOS | `public.json`, `public.comma-separated-values-text` |
| `dialogTitle` | Android, web | a translated string (never a literal) |
| `anchor` `{ x, y, width, height }` | iOS (iPad popover) | the pressed button's frame from `measureInWindow`; omitted on a phone |

- **What the promise means.** `shareAsync` returns `Promise<void>`; the docs do not say whether the user
  sent the file anywhere or dismissed the sheet. The port returns `'sheet-closed'`, and the screen never
  says "Backup saved" on it. (Saving to Files or Drive is one of the sheet's targets; the user decides.)
- **iPad.** Without an anchor the popover has nothing sensible to point at. Pass the frame of the control
  that was pressed (examples/src/features/backup/backup-screen.tsx). Verified from the types only.
- **Android.** expo-sharing hands the `file://` path to other apps through its own FileProvider; the app
  needs no manifest change for files in its cache or documents folders (library behaviour, read in the
  docs; not device-verified here).
- **Web.** `isAvailableAsync()` is false without the Web Share API (and local files cannot be shared by
  URI there): the port returns `unavailable`, and the screen offers no share button.
- **Only from a press.** This skill's ports never upload, and a file leaves through them only from a
  press: never on mount, focus, a timer or an app-state change (check-backup: `user-action-only`). An
  opt-in scheduled cloud backup is a separate feature: it goes through the app's API client
  (networking-and-server-state), changes the store privacy answers (privacy-and-store-declarations),
  and still writes this envelope and restores through this ladder and confirmation.

## 5. FilePickerPort over expo-document-picker

`getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false })` (expo-document-picker 57)
resolves `{ canceled: true, assets: null }` or `{ canceled: false, assets: [{ uri, name, size?, mimeType?,
lastModified }] }`. A cancel is `ok(null)` (the user changed their mind), not a failure.

- **`copyToCacheDirectory: true`** (the default, set explicitly): the docs warn the file system may not be
  able to read the original right after the pick; the copy is a `file://` URI `File.text()` reads at once.
- **`type: '*/*'`.** Providers label one `.json` differently (`application/json`,
  `application/octet-stream`, `text/plain`); filtering by MIME hides valid backups on some providers. The
  envelope, not the label, decides (envelope-and-ladder.md, rung 1-2). The name and size are shown in the
  confirmation; the size is checked against `MAX_BACKUP_BYTES` before reading (by the service when the
  picker reports one, by `readText` from the file on disk when it does not).
- **iOS** shows the Files picker (iCloud Drive and file providers). Importing a copy needs no iCloud
  entitlement; `usesIcloudStorage` and `iCloudContainerEnvironment` matter only for an app that keeps its
  own iCloud container (per the docs; not device-verified here).
- **Android** shows the system document picker (Storage Access Framework); the picked `content://`
  document is copied into the cache by the library.
- `File.pickFileAsync` (expo-file-system 57) is a newer alternative; its SDK 57 docs disagree on platforms
  and on whether it copies the file, so this skill uses expo-document-picker until that settles.

## 6. Folders, device backups and cleanup

| Folder | Holds | Purged by the system | In device backups |
|---|---|---|---|
| `Paths.cache/exports/` (`'share'`) | files handed to the share sheet | yes, when storage runs low | no |
| `Paths.document/backups/` (`'private'`) | the one safety copy | no | yes (iCloud and computer backups on iOS; Android Auto Backup includes the files folder, 25 MB per app) |
| the picker's cache copy | the picked file | yes | no |

- **Sweep on the next export, not after the sheet closes.** `exportBackup` calls `files.sweep('share',
  name)` before writing, so old exports (copies of user data outside the database) do not pile up. They
  are not deleted when `shareAsync` resolves: on Android a receiving app may read the shared file after
  the sheet has closed (an email app attaching it while composing), and a deleted file arrives empty.
  (Reasoned from how share targets read content; not observed on a device here.)
- **The private folder is invisible to the pickers.** Android's document picker never lists another
  app's private `files/` folder. On iOS the Files app and picker show the app's Documents folder only
  when the app sets expo-file-system's config plugin options `enableFileSharing`
  (`UIFileSharingEnabled`) and `supportsOpeningDocumentsInPlace` (`LSSupportsOpeningDocumentsInPlace`)
  through expo-prebuild-and-config-plugins (read in the plugin source, expo-file-system 57). Neither is
  needed for share and pick, so the app offers the safety copy itself (`previewSafetyCopy`).
- **Android Auto Backup budget.** The safety copy counts toward the 25 MB per-app limit together with
  `app.db` and its snapshots (persistence-and-migrations); one overwritten file keeps that bounded.

## 7. Wiring: classification and composition

- **Classify the two new SDKs before the first import** (stop and ask the developer: it is an
  architecture decision). Merge examples/contracts/architecture.json into the app's
  `contracts/architecture.json` (`expo-sharing` → ShareSheetPort, `expo-document-picker` → FilePickerPort)
  and add both to `VENDOR_SDK_PATHS` in `eslint.config.mjs` in the same commit (a Gate-Change trailer).
  `expo-file-system` is already a default vendor SDK. Without this, architecture-and-boundaries'
  `unclassified-sdk` rule fails on the adapters.
- **Compose once.** `createDeviceServices` gains `exportFiles`, `shareSheet` and `filePicker` (one member
  each in `Services`, one line in each factory, fakes in `createTestServices`), and the data layer's
  device opener builds the service once: `backup: createBackupService({ repository:
  createSqliteBackupRepository({ driver, errorLog }), files, shareSheet, filePicker, clock, appVersion,
  isPersistent: database.isPersistent })` as a member of `AppData`. Features read
  `useAppData().backup`; nothing creates an adapter at import time.
- **appVersion** comes from the build (`expo-application`'s `nativeApplicationVersion`, or the app
  config through `expo-constants`), read in the composition, passed as a value.

## 8. The export-share-restore drill (named devices)

What Jest cannot prove: the real files, sheet and picker. Run it after changing an adapter, on a named
simulator and emulator (never "the booted one"; create `<project>-backup` devices if needed), with a
development or Release build installed (ios-simulator-build, android-emulator-build):

1. Add a few tasks with hostile text (a quote, `=1+2`, an emoji, an RTL title). Export the backup; the
   sheet opens anchored to the button (iPad simulator too). Save it to Files (iOS) or Downloads (Android).
2. Export CSV and open it in a spreadsheet app or a text viewer: a BOM, CRLF lines, `'=1+2` as text.
3. Copy the backup to the computer and run `node ${CLAUDE_SKILL_DIR}/scripts/inspect-backup.mjs <file>
   --format <app>.backup --schema <N>`: it prints the header and rows and ends `RESULT: PASS`.
   iOS: `xcrun simctl get_app_container <udid> <bundle-id> data` shows the app's folders;
   Android (a debuggable build): `adb -s <serial> exec-out run-as <package> cat files/backups/<slug>-before-restore.json`.
4. Delete some tasks, restore the backup: the confirmation names the counts and "replace"; tap
   "Replace" twice quickly; the tasks are back once and `backups/<slug>-before-restore.json` holds the
   deleted state. Then "Restore the data from before your last restore": the deleted state comes back.
5. Pick a CSV, an empty file and a hand-edited backup: three different messages, nothing changes.

Say in the report that the drill is owed when no build was available.

## 9. Not covered here

- Receiving files shared into the app (expo-sharing's incoming-share API is experimental in SDK 57; with
  Expo Router it arrives through `+native-intent.ts`): deep-links-and-universal-links' gate refuses
  any URL its allow-list lacks (a `file://` or `content://` URL fails as a foreign scheme), so the
  hand-off needs a landing route in its `LINK_ROUTES` with a closed-kind key, and that screen reads the
  shared file from the share library's store. The file then goes through the same `readBackup`
  ladder and confirmation, never straight to `replaceAll`.
- Photos, documents a feature stores as attachments, and media libraries: media-images-and-files.
  Media files are not in the envelope (MediaRef columns travel as names); when the app's restore flow
  has a step after `replaceAll` commits, run media-images-and-files' `sweepMedia` there (the safety copy's refs as
  `protectedRefs`, so undoing the restore still finds its files).
- A support copy of the database file (`app.db` with its `<file>.v<N>.bak` snapshots, after a
  `PRAGMA wal_checkpoint(TRUNCATE)`): a different feature from a backup. It is never restorable
  through the ladder (it is not the envelope, rule 1), it holds every row in readable form, so it is
  offered only from a support screen, after the user agrees, through the same ShareSheetPort, and the
  privacy declarations name it. Support restores it on a copy with run-migration's `restore-snapshot
  --dir`; this skill ships no template for it.
- Cloud sync and opt-in server backups: networking-and-server-state (and a privacy review); the same
  envelope, ladder and confirmation apply.
