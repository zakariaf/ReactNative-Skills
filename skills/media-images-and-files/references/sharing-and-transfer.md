# Sharing, saving to Photos, uploads and downloads

How a stored image leaves the app: the share sheet, the photo library, and the network. Each path is
a port called from a press; none of them carries location metadata or the person's file names.
Read in `expo-sharing` 57.0.22, `expo-media-library` 57.0.5 (types, config plugin and Android
sources) and `expo-file-system` 57.0.7 type declarations (2026-10-14). Re-verify: `npm view expo-media-library@~57.0.5 version`,
https://docs.expo.dev/versions/v57.0.0/sdk/media-library/.

## Contents

1. Decisions
2. Sharing an image: data-export-and-restore's ShareSheetPort
3. Saving to the photo library (expo-media-library 57)
4. Uploads and downloads: the file-transfer port
5. Privacy: what leaves the device
6. Receiving images shared into the app
7. Pitfalls

## 1. Decisions

| Decision | Why |
|---|---|
| Share through data-export-and-restore's `ShareSheetPort` (expo-sharing), never a second share port | One adapter per SDK (architecture-and-boundaries); the iPad anchor and the "sheet closed means nothing" rule are already there |
| Save to Photos through a `PhotoSaverPort` over expo-media-library's object API (`examples/src/services/photo-saver/`) | SDK 57 throws on the old `saveToLibraryAsync`; add-only permission through the gate |
| Uploads and downloads through `FileTransferPort` (`examples/src/services/file-transfer/`), the app's second network transport | The JSON `ApiClient` does not carry file bodies (networking-and-server-state hands them here); one adapter is the only caller of expo-file-system's network API (`transfer-outside-port`) |
| Only stored, re-encoded files leave the device | They carry no EXIF block, so no GPS position or device data |

## 2. Sharing an image: data-export-and-restore's ShareSheetPort

```ts
const shared = await shareSheet.shareFile({
  uri: mediaStore.uriOf(ref),          // the stored file, never the picked original
  mimeType: mimeTypeOf(ref),           // Android intent type: 'image/jpeg', 'image/png'
  uti: utiOf(ref),                     // iOS: 'public.jpeg', 'public.png', 'org.webmproject.webp'
  dialogTitle: t('tasks.photos.share-title'),
  anchor,                              // iPad: the pressed control's frame (measureInWindow)
});
// shared.ok: the sheet closed (nothing more is known). 'unavailable' / 'share-failed': its own message.
```

- `mimeTypeOf` and `utiOf` (`templates/src/core/media/media-ref.ts`) follow the stored extension, so a
  kept PNG or GIF is never announced as JPEG.

- The port, its adapter and fake are data-export-and-restore's templates
  (`src/services/share-sheet/`). Copy them from there if the app has none; never write a second
  expo-sharing adapter.
- `shareAsync` resolves when the sheet closes; it does not say whether the image went anywhere. Never
  say "Saved" after it.
- Files in `Paths.document` and `Paths.cache` are shared through expo-sharing's own FileProvider on
  Android; no manifest change (per data-export-and-restore's platform notes).
- Several images at once: expo-sharing shares one URI per call. Share them one after the other only if
  the person asked for each; a multi-file share needs another API and its own decision.

## 3. Saving to the photo library (expo-media-library 57)

SDK 57's `expo-media-library` main entry throws at runtime for the old functions (`saveToLibraryAsync`,
`createAssetAsync`, `getAssetsAsync`, `getAlbumsAsync`, `createAlbumAsync`, `deleteAssetsAsync`,
`addAssetsToAlbumAsync`, ... 19 names in `legacyWarnings.d.ts`); `expo-media-library/legacy` keeps them
for migration, deprecated. check-media's `legacy-api` reports both. The object API:

| Need | Call |
|---|---|
| save a file as a new asset | `await Asset.create(fileUri, album?)` |
| an album | `await Album.create(name, assets)`, `album.add(...)` |
| add-only permission | `requestPermissionsAsync(true)` (write-only), read with `getPermissionsAsync(true)`: both only in permissions-and-system-prompts' adapter |
| read the library (a custom gallery) | `requestPermissionsAsync(false, ['photo'])`, `Query`, `Asset` |

- Add-only access asks for `NSPhotoLibraryAddUsageDescription` on iOS (the plugin's
  `savePhotosPermission`); reading asks for `NSPhotoLibraryUsageDescription` (`photosPermission`).
- **Android needs no read permission to save.** On Android 10+ `Asset.create` inserts into MediaStore
  without any permission (the write-only path leaves the granular permissions out:
  `SystemPermissionsDelegate.getManifestPermissions(writeOnly = true)`); only Android 9 and lower use
  `WRITE_EXTERNAL_STORAGE` (`AssetLegacyFactory` checks it). Yet the plugin always declares
  `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and `READ_MEDIA_VISUAL_USER_SELECTED`, plus one
  `READ_MEDIA_*` per `granularPermissions` entry (default `['photo', 'video', 'audio']`; read in
  `withMediaLibrary.js`, expo-media-library 57.0.5).
- **Google Play's Photo and Video Permissions policy** allows `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO`
  only for apps whose core feature needs broad library access; any other app must use the system photo
  picker or file a declaration (picking-and-capturing.md, section 4). A save-only app therefore lists:

  ```ts
  ['expo-media-library', {
    savePhotosPermission: sourceText(projectRoot, 'permissions.photos-add.usage-description'),
    photosPermission: false,          // removes NSPhotoLibraryUsageDescription: the app never reads
    granularPermissions: [],          // no READ_MEDIA_IMAGES / VIDEO / AUDIO
  }],
  // and in the config's android block:
  blockedPermissions: [
    'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  ],
  ```

  `blockedPermissions` also keeps out a `READ_MEDIA_*` another library would add. `WRITE_EXTERNAL_STORAGE`
  stays for Android 9 and lower. This result is read in the sources, not proven on a store build:
  **verify it in the merged `AndroidManifest.xml` and Info.plist after prebuild**
  (expo-prebuild-and-config-plugins' native snapshot) and save once on an Android 13+ emulator and an
  Android 9 one in the drill. check-media's `unused-permission` reports `READ_MEDIA_IMAGES`/`VIDEO`
  declared while no code reads the library (`Query`, `getAssetsAsync`, `Album.getAll`).
- A gallery that reads the library keeps `granularPermissions: ['photo']` (plus `'video'` if it shows
  videos), declares the use in the Play Console, and asks through the gate's `photos` kind.
- The permission request lives in `src/services/permissions/` (permissions-and-system-prompts, kind
  `photos-add`: `requestPermissionsAsync(true)`); the saver adapter imports no permission function. The
  composition root injects `isAddAllowed` (the gate's access), and the adapter answers
  `permission-needed` without it (`examples/.../expo-media-library-photo-saver-adapter.ts`).
- The adapter example was type-checked against expo-media-library 57.0.5; it is not a template because
  the reference app does not install the package.

## 4. Uploads and downloads: the file-transfer port

networking-and-server-state's `ApiClient` sends and validates JSON only; a file body goes through this
second transport, which keeps every rule of the first:

- **The URL** comes from `src/api` (`buildUrl` over the checked `EXPO_PUBLIC_API_URL` base), never a
  literal; **the headers** from the session (`sessionHeaders`, auth-and-secure-storage), never a token
  in the query string.
- **The adapter** (`expo-file-system-file-transfer-adapter.ts`) is the only file that calls
  `File.upload`, `file.createUploadTask`, `File.downloadFileAsync` or `File.createDownloadTask`
  (`transfer-outside-port`). It maps outcomes to `TransferFailure`: `source-missing` when the file to
  upload is gone (checked before sending: a stale ref, not a network problem), `cancelled` when the
  signal aborted, `offline` only when networking-and-server-state's `ConnectivityPort.isOnline()` says
  the device is off the network, `transfer-failed` for every other rejection (DNS, TLS, a bad URL, a
  dropped connection, a non-2xx download), and `http` with the status for a non-2xx upload. The person
  is never told to check a connection that works. The caller validates the JSON body with its valibot
  schema in `src/api`.
- **Uploads** send the stored, downscaled file (multipart, `fieldName`, `mimeType`), with an
  `Idempotency-Key` header made when the person started the action, so a retry after a timeout does not
  create two attachments (networking-and-server-state's idempotency rule).
- **Downloads** (`download({ url, fileName, headers, signal })`) go to `Paths.cache/downloads/` under a
  fresh name (never the server's file name), then through the resizer and `MediaStorePort.importFile`
  under a new ref when they must be kept, and the temporary is discarded. On Android a download that
  fails part-way can leave a partial file at the destination (per the `File.downloadFileAsync` docs):
  the adapter deletes it, and downloading into the cache keeps the media folder clean either way.
- `sessionType: 'background'` (iOS background URL session) only for transfers that must finish after
  the app leaves the foreground; background-tasks owns that decision.
- Register the transport with networking-and-server-state (a second transport is an entry in its
  rules) and declare it with privacy-and-store-declarations before it ships.

## 5. Privacy: what leaves the device

- Photos the person attaches are personal data. If they ever leave the device (upload, sync), the App
  Store privacy answers list **Photos or Videos** and Play's Data safety lists **Photos and videos**,
  with the purpose (privacy-and-store-declarations owns the answers and the SDK inventory).
- Sharing through the system sheet is the person's own act and is not collection by the app.
- No EXIF in what leaves: the picker never hands EXIF to JS (`exif: false`), and the resizer's
  re-encode writes pixels only (UIImage.jpegData on iOS, Bitmap.compress on Android, read in the
  expo-image-manipulator 57 sources). Check a shared file with `exiftool` in the drill: no `GPS*` tags.
- File names that leave the device are MediaRefs (random ids), never the original "IMG_2041.HEIC" or a
  name the person typed.

## 6. Receiving images shared into the app

Receiving an image from another app's share sheet (an iOS share extension, an Android `SEND` intent)
needs a share library and native configuration; neither this skill nor deep-links-and-universal-links
ships one. Know what the app's link gate does with the hand-off: deep-links-and-universal-links'
`+native-intent.tsx` refuses every URL its `LINK_ROUTES` table does not list, so a `file://` or
`content://` URL fails as a foreign scheme and a library's `<scheme>://dataUrl=<key>` hand-off as an
unknown route, and the person lands on the first screen. The hand-off therefore needs a landing route
listed in `LINK_ROUTES` (for example `{ path: '/share-received', query: ['dataUrl'] }` with a
closed-kind key) and a screen that reads the shared item from the share library's own store by that
key, never a file path from the URL. The received file is a temporary: it goes through the resizer
and `MediaStorePort.importFile` like a picked one, and the person confirms where it belongs.

## 7. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| "Save to Photos" crashes after the SDK upgrade | `saveToLibraryAsync` from the main entry throws in SDK 57 | `Asset.create(uri)` (`legacy-api`) |
| A shared photo reveals where it was taken | the original picked file (with EXIF) was shared | share only stored, re-encoded files |
| Duplicate attachments after a slow network | the upload was retried without an idempotency key | `Idempotency-Key` from the action |
| An upload goes to the wrong server in a preview build | a literal URL in a feature | URLs from `src/api` and `src/config` (`transfer-outside-port`, the ESLint `remoteUrl` rule) |
| The share sheet points at nothing on iPad | no anchor | the pressed control's frame |
| The Play Console asks for a Photo and Video Permissions declaration for a "Save to Photos" button | expo-media-library's default `granularPermissions` declare `READ_MEDIA_IMAGES`/`VIDEO` | the save-only config in section 3 (`unused-permission`) |
| "Check your connection" while online | every upload rejection mapped to `offline` | `offline` only from `ConnectivityPort`; `source-missing` and `transfer-failed` otherwise |
