# Files and storage: the media store (expo-file-system, Expo SDK 57)

Where media files live, how they are named, written, resolved, deleted and swept, how much space they
take, and the expo-file-system API this rests on. API read in the `expo-file-system` 57.0.7 type
declarations (`File`, `Directory`, `Paths`, `legacyWarnings.d.ts`) on 2026-10-14; re-verify with
`npm view expo-file-system@~57.0.7 version` and https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/.

## Contents

1. Decisions
2. The folders
3. MediaRef: names, not URIs
4. Importing: downscale, copy, discard
5. Never overwrite: a changed image is a new file
6. Owners, deletes and the orphan sweep
7. Disk space and device backups
8. The expo-file-system 57 API (and the legacy names that throw)
9. Data export, restore and media
10. Pitfalls

## 1. Decisions

| Decision | Why |
|---|---|
| One media folder, `Paths.document/media/`, behind `MediaStorePort` | Kept by the OS, included in device backups, one place to list and sweep |
| Records hold a `MediaRef` (a plain file name), never a URI or path (`stored-uri`) | The absolute path of the app's folders is not stable: Apple documents that the app container's location can change (the UUID in the path is commonly observed to change after an app update or a restore from backup), and a restore onto another Android device or profile changes the data path. A stored `file://` URI then points nowhere |
| A new name for every file; never overwrite (`overwrite-in-place`) | Image caches are keyed by URI; a crash mid-write would corrupt the only copy |
| Partial file, then a rename into place | No half-written file ever carries a name a record can hold |
| Temporaries (picker, resizer output) are discarded after the import; only cache files can be discarded | A bug can never delete a stored file or the person's original through the temporary path |
| Orphans are swept after startup (`sweep-wired`) | Crashes and abandoned imports leave files no record references; nobody else ever deletes them |

## 2. The folders

| Folder | What lives there | Purged by the OS | In device backups |
|---|---|---|---|
| `Paths.document/media/` | stored media (`MediaStorePort`) | no | yes (iCloud and computer backups on iOS; Android Auto Backup includes the files folder, 25 MB per app) |
| `Paths.cache/ImagePicker/` | picker and camera output | yes, under storage pressure | no |
| `Paths.cache/ImageManipulator/` | resizer output | yes | no |
| `Paths.cache/<expo-image cache>` | expo-image's disk cache | yes | no |
| `Paths.document/backups/`, `Paths.cache/exports/` | data-export-and-restore's safety copy and shared exports | as in that skill | as in that skill |

`media-in-cache` fails a media store that builds its folder on `Paths.cache`.

## 3. MediaRef: names, not URIs

`templates/src/core/media/media-ref.ts`:

- `MediaRef` is a branded string `^<id>\.(jpg|png|webp|gif)$` with a lowercase id of letters, digits and
  inner hyphens (at most 80 characters): safe in every file system, URL and SQL text column.
- `createMediaRef(id, extension)` makes a new one; `parseMediaRef(text)` reads one back from a row, a
  backup or a folder listing (a URI or path is `invalid-ref`).
- Ids come from the composition root (`nextMediaId`): the app's own id scheme, by default
  `() => randomUUID().toLowerCase()` with `randomUUID` from expo-crypto (`npx expo install
  expo-crypto`). Hermes on React Native 0.86 has no global `crypto.randomUUID`, so the web API is
  undefined at runtime. Never the picked file's name (untrusted, may collide, may leak
  something personal such as a person's name).
- Store it in a `TEXT` column named `*_ref` or `*_media` (persistence-and-migrations owns the table and
  the migration), or a field typed `MediaRef` in a store (state-management-zustand).
- Resolve it at render time: `mediaStore.uriOf(ref)` in the model hook, passed to `StoredImage` as `uri`.
- check-media's `stored-uri` fails a `*Uri: string` field (or `v.string()` schema) in `src/data/` or
  `src/stores/`, and a `*_uri TEXT` column. A server image is a URL: name it `*Url`.

## 4. Importing: downscale, copy, discard

`templates/src/data/media/media-importer.ts` runs this per picked image, one at a time:

1. `createMediaRef(nextMediaId(), 'jpg')`.
2. `resizer.downscale({ uri, size, maxEdgePx: 2048, quality: 0.8 })`: one JPEG encode, no metadata, a
   new temporary in the cache.
3. Discard the picked temporary.
4. `store.importFile({ sourceUri, ref })`: checks the name is free, the source exists and the disk has
   the file's size plus 5 MB; copies to `.<ref>.partial` in the media folder, renames it to `<ref>`
   (`moveSync` within one folder is a rename on both platforms' file systems), deletes the partial on
   failure. A crash mid-copy leaves the partial behind; the sweep's `removeStalePartials` deletes it.
5. The stored ref joins `importer.sessionRefs()` at once (section 6), then the resized temporary is
   discarded.

A batch is all or nothing: when image 3 of 5 fails, images 1-2 are removed again (and leave the
session set), the remaining temporaries are discarded, and the failure kind is returned
(`no-space`, `resize-failed`, ...). The stored refs stay in the session set for the life of the
process, saved or not: a sweep keeps them, and the model removes the files itself if the record save
fails.

## 5. Never overwrite: a changed image is a new file

Rotating, cropping or replacing a photo writes a new file under a new `MediaRef`, saves the record with
the new ref, then removes the old file. Never `overwrite: true` in the media store, never `write()` over
an existing stored name:

- expo-image keys its memory and disk caches by URI: an overwritten file keeps showing the old pixels in
  every view until the cache is evicted (on both platforms).
- A crash during an in-place write leaves the only copy truncated.
- Backups and uploads that already copied the old file stay consistent with their records.

## 6. Owners, deletes and the orphan sweep

- **Every stored file has exactly one owner record** (a task's photo list, a note's cover). Deleting the
  owner deletes the file; removing a photo from a record deletes the file. Order: save the record first,
  then remove the file. A crash in between leaves an orphan (harmless; the sweep removes it), never a
  record pointing at a deleted file.
- **The sweep**: `sweepMedia({ store, referenced, sessionRefs: importer.sessionRefs(), protectedRefs })`
  (`templates/src/data/media/media-sweeper.ts`) lists the folder, plans with `planMediaSweep`
  (`templates/src/core/media/media-sweep.ts`), deletes orphans, keeps every file this process
  imported and every file the restore's safety copy references (section 9), and reports referenced files that are missing (show the "photo
  unavailable" placeholder; record once through the error log). `referenced` is read from every table
  that holds a MediaRef: a repository method such as `allMediaRefs()` per table, unioned.
- **When**: once after startup, when the records are readable (after the startup gate released the
  splash, from the background work app-startup-and-bootstrap defines), and after a restore. In the
  startup work, `await importer.importPendingPick()` and save its refs first, then sweep: the pending
  pick's files are then referenced (and in the session set anyway). `sweep-wired` fails an app that creates a media
  importer but never calls `sweepMedia`.
- **Protected from the first stored file until the process ends.** The importer adds each ref to
  `sessionRefs()` the moment the store accepted it, not when the batch ends, takes it out only when the
  batch rolls back, and never when the record is saved. A person may press "Add photo" while the
  post-startup sweep runs, and the sweep reads `referenced` table by table with awaits. Two orders
  would otherwise delete a live file: the sweep runs while image 2 of a batch is still resizing (image
  1 is not referenced yet), or the job saves the new ref to a table the sweep already read and then
  drops it from a "pending" set (the ref is in neither list). Keeping every ref of this process closes
  both; a file abandoned this session (a failed save whose delete also failed) is an ordinary orphan
  at the next launch. `media-importer.test.ts` runs a sweep from the second resize, and one whose
  table reads straddle a save, and checks both files survive.
- **Partial copies.** A crash during `source.copy(partial)` leaves `.<ref>.partial` in the folder;
  `list()` never shows it (it is not a MediaRef), so the sweep first calls
  `store.removeStalePartials()`, which deletes every partial no copy of this process is still writing
  (`partialsRemoved` in the report).
- A failed delete stays for the next sweep (`failed` in the report).

## 7. Disk space and device backups

- Stored images are at most 2048 px on the long edge at JPEG quality 0.8: a few hundred KB each (about
  300 to 800 KB for a typical photo; the exact size depends on the content).
- `importFile` refuses with `no-space` below the file size plus a 5 MB margin (`Paths.availableDiskSpace`),
  so an import never fills the disk the database needs.
- **Android Auto Backup** keeps at most 25 MB per app (database, preferences and files together). An
  app whose media can exceed that either excludes the media folder from Auto Backup (an
  `android:fullBackupContent`/`dataExtractionRules` config through expo-prebuild-and-config-plugins) and
  says so in the UI, or offers its own export (data-export-and-restore). Decide and write it down; never
  let the database fall out of the backup because photos filled the quota (Android's documented
  behaviour: over the limit, the backup is not made).
- **iOS** backs up `Documents/` to iCloud and computer backups. Large, re-downloadable content belongs in
  the cache or excluded from backup; the person's own photos belong in the backup.

## 8. The expo-file-system 57 API (and the legacy names that throw)

The object API: `new File(...uris | Directory | File)`, `new Directory(...)`, `Paths.document`,
`Paths.cache`, `Paths.bundle`, `Paths.availableDiskSpace`, `Paths.totalDiskSpace`, `Paths.info(uri)`.

| Need | Call |
|---|---|
| exists, size, md5 | `file.exists`, `file.size` (0 when missing), `file.md5`, `file.info({ md5: true })` |
| read | `await file.text()`, `await file.bytes()`, `await file.base64()` (avoid for images), `file.textSync()` |
| write | `file.create({ intermediates, overwrite })`, `file.write(text | Uint8Array, { encoding, append })` |
| copy, move, rename | `await file.copy(dest)`, `file.copySync(dest)`, `await file.move(dest)`, `file.moveSync(dest, { overwrite })`, `file.rename(name)` |
| delete | `file.delete()`, `directory.delete()` |
| list | `directory.list()` (File and Directory instances), `directory.listAsRecords()` |
| create a folder | `directory.create({ intermediates: true })` |
| network | `File.downloadFileAsync(url, dest, { headers, signal })`, `file.upload(url, options)`, `File.createDownloadTask`, `file.createUploadTask`: only in the file-transfer adapter (sharing-and-transfer.md) |
| pick a file | `File.pickFileAsync(...)` (the newer picker); data-export-and-restore uses expo-document-picker |

**The legacy functions throw at runtime in SDK 57.** Importing `readAsStringAsync`, `writeAsStringAsync`,
`getInfoAsync`, `deleteAsync`, `moveAsync`, `copyAsync`, `makeDirectoryAsync`, `readDirectoryAsync`,
`downloadAsync`, `uploadAsync`, `createDownloadResumable`, `createUploadTask` (the main-entry function;
the `file.createUploadTask` method is the current API), `getFreeDiskStorageAsync`,
`getTotalDiskCapacityAsync`, `getContentUriAsync` or `deleteLegacyDocumentDirectoryAndroid` from
`'expo-file-system'` compiles (they are declared with `@deprecated`) and throws when called.
`documentDirectory` and `cacheDirectory` are no longer exported at all: in this TypeScript stack a named
import or a namespace access is a tsc error, and only untyped JavaScript gets `undefined` (where
`${undefined}photo.jpg` is a silent bug). `expo-file-system/legacy` still works: it is
kept for migration, and the object API is the supported one. check-media's `legacy-api` reports all of these. The same holds for `expo-media-library`
(sharing-and-transfer.md, section 3).

## 9. Data export, restore and media

data-export-and-restore's backup envelope holds table rows, so MediaRef columns travel as names and the
files stay behind. Choose one, and write it down:

- **Default**: the backup carries refs only; after a restore on the same device the files are still in
  the media folder; on a new device the records show the "photo unavailable" placeholder (the sweep
  reports them as missing). Say so in the export screen ("Photos are not included").
- **Media in backups**: a separate archive (a zip of the media folder next to the envelope, its own
  checksum) designed with data-export-and-restore; never base64 images inside the JSON envelope.

After a restore, run the sweep: files whose records were replaced become orphans, **except the ones
the safety copy still references.** data-export-and-restore writes a private safety copy before each
restore and offers it as the undo ("Restore the data from before your last restore"). The undo of a
restore needs its photos: every MediaRef the safety copy holds is passed as `protectedRefs` to every
sweep (after the restore and at each launch) while the copy exists, and is never an orphan until the
next restore replaces the copy. Read them from the decoded safety-copy envelope (the same MediaRef
columns the live tables have; data-export-and-restore owns the envelope and its reader); an app
without restore passes an empty set. Without this, a person who restored the wrong file and then
undid it gets every record back with "photo unavailable".

## 10. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| All photos are blank after an app update (iOS) or a restore | records hold absolute `file://` URIs | MediaRefs resolved with `uriOf` (`stored-uri`) |
| Photos disappear after some days | stored in the cache, or the picker temporary kept | the media folder in `Paths.document` (`media-in-cache`) |
| An edited photo shows the old image | overwritten in place | new ref per change (`overwrite-in-place`) |
| Storage grows forever | orphans from crashes and abandoned drafts | `sweepMedia` after startup (`sweep-wired`) |
| A runtime error that the method is deprecated, or `undefined` in a path | legacy expo-file-system names | the object API (`legacy-api`) |
| The Android backup silently stops including the database | media pushed the app over Auto Backup's 25 MB | exclude the media folder or keep media small; decide explicitly |
