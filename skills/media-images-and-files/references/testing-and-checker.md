# Tests, the device drill and check-media

What the shipped tests prove, how to test media code with the fakes, the manual drill on named
devices that covers the adapters, and every rule of `check-media.mjs` with its fix.

## Contents

1. The shipped tests
2. Testing a feature with the fakes
3. The media drill (named simulator and emulator)
4. check-media rules
5. Configuration, SKIP and NOT APPLICABLE
6. What no checker proves

## 1. The shipped tests

| Test | Proves |
|---|---|
| `src/core/media/media-ref.test.ts` | names are plain, URIs and paths are refused, MIME types map to stored extensions, HEIC is not stored as is, each stored format has its MIME type and iOS type identifier (`utiOf`) |
| `src/core/media/image-fit.test.ts` | the 12 MP photo fits 2048 x 1536; no upscaling; thin panoramas keep a pixel; a fast-check property over 1-20,000 px sizes (whole, within the limit, never larger, within half a pixel of exact); decoded memory |
| `src/core/media/media-sweep.test.ts` | orphans and missing files are found and sorted; files the importer stored this session are never orphans |
| `src/services/media-picker/fake-media-picker.test.ts` | the fake answers queued picks, refuses a capture without the camera permission or without a camera (like the adapter), gives a pending pick once |
| `src/services/media-store/fake-media-store.test.ts` | import under a new name, no overwrite, a purged temporary is `source-missing`, idempotent remove, only cache temporaries are discarded, stale partial copies are removed and never listed |
| `src/services/image-resizer/fake-image-resizer.test.ts` | the fitted output size, one failure on demand |
| `src/data/media/media-importer.test.ts` | one resize per image at the app's limits, both temporaries discarded, all or nothing on failure, typed failures passed through, camera and pending picks, session refs kept after the save and dropped on rollback, a sweep that runs while the batch resizes its second image keeps the first file, a sweep whose table reads straddle a record save keeps the new file |
| `src/data/media/media-sweeper.test.ts` | orphans and stale partials deleted, referenced and session files kept, failed deletes reported, a listing failure deletes nothing |
| `src/ui/media/stored-image.test.tsx` | a content image is an accessibility element with its label, testID and size; a decorative one is hidden |

Run: `npx jest src/core/media src/services/media-picker src/services/media-store src/services/image-resizer src/data/media src/ui/media --ci`
and `npm run typecheck`. The adapters are device-only (`// device-only: covered by ...` in their first
lines, so coverage leaves them out); the drill below covers them.

## 2. Testing a feature with the fakes

- Build the importer from the fakes and wire the resizer's output into the store, as
  `media-importer.test.ts` does (`resizer.onOutput(store.giveTemporary)`), then pass it to
  `createTestServices({ mediaImporter, mediaStore })` and render the screen with
  `renderWithProviders` (unit-and-component-tests).
- Queue what the person does: `picker.queuePick(ok([pickedImageFixture('a.jpg')]))`, a cancel
  (`ok([])`), a failure (`err({ kind: 'pick-failed' })`), `picker.setCameraAllowed(false)`,
  `store.failNextImport({ kind: 'no-space', ... })`, `store.plantPartial(ref)` (a crash mid-copy).
- The picker fake answers `permission-needed` after `setCameraAllowed(false)`, like the adapter whose
  injected `isCameraAllowed` answers false, and `camera-unavailable` after `setCameraPresent(false)`
  (the adapter's `isCameraPresent`, false on the iOS simulator); the gate itself is tested with permissions-and-system-prompts'
  fake permissions (`createFakePermissions`) in the model hook's test.
- Assert what the person sees for each failure kind (one message each), that the busy state blocks a
  second press, that a failed record save removes the new files (`store.stored()`), and that
  `StoredImage` receives `uriOf(ref)`, never the picked URI.
- `examples/src/features/tasks/use-task-photos-model.test.tsx` is the shape: the importer over the
  fakes, `createFakePermissions({ camera: createFakePermissionAccess({ platform, state, answers }) })`,
  the canonical providers plus the app's `I18nProvider`, and one test per gate outcome on iOS and
  Android (allowed, refused, Android's rationale, blocked with Settings) and for a failed record save.
  It also satisfies check-permissions' `asked-from` rule for the camera entry.
- Never `jest.mock('expo-image-picker')` in a feature test: the feature talks to the port.

## 3. The media drill (named simulator and emulator)

What Jest cannot prove: the real picker, camera, file system, resizer and share sheet. Run it after
changing an adapter, on a simulator and an emulator named for this (never "the booted one"; create
`<project>-media` devices if needed), with a development or Release build installed
(ios-simulator-build, android-emulator-build):

1. **Put photos on the device.** iOS: `xcrun simctl addmedia <udid> ~/fixtures/portrait.heic
   ~/fixtures/landscape.jpg ~/fixtures/gps.jpg`. Android: `adb -s <serial> push gps.jpg
   /sdcard/Pictures/` then `adb -s <serial> shell am broadcast -a
   android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/gps.jpg` (or open the Files
   app once). Use a photo with GPS tags and a portrait HEIC.
2. **Pick three photos** (one HEIC portrait). They appear upright, in the chosen order, as thumbnails;
   VoiceOver/TalkBack reads "Photo 1 of 3".
3. **Inspect what was stored.** iOS: `xcrun simctl get_app_container <udid> <bundle-id> data`, then
   `Documents/media/`; Android (debuggable build): `adb -s <serial> exec-out run-as <package> ls -l
   files/media`. Each file is a JPEG of at most 2048 px; `exiftool` shows no `GPS*` tags; nothing is left
   in `Library/Caches/ImagePicker` or `cache/ImagePicker` and `ImageManipulator`.
4. **Camera**: capture is tested on the Android emulator (virtual scene) or a device, never on the iOS
   simulator, where UIKit raises an exception for the missing camera and the app would crash without
   the adapter's `isCameraPresent` check. On the emulator take a photo: the gate explains first; deny
   once (rationale), deny again (settings). On the iOS simulator check only that "Take photo" shows the
   camera-unavailable message (`isCameraPresent` answered false before `launchCameraAsync`).
5. **Lost activity (Android)**: Developer options, "Don't keep activities" on; pick a photo; it is
   imported after the app comes back (`importPendingPick`).
6. **Recycling**: add 30 photos across tasks, scroll the strip fast: no cell flashes another photo.
7. **Share** a photo (iPad simulator too: the popover points at the thumbnail) and **save to Photos**
   when the app has it.
8. **Orphans**: kill the app right after a pick (before the record saved); relaunch: the sweep removes
   the file (`ls` again).
9. **Update**: install the build again over itself (`xcrun simctl install <udid> <app>`, `adb -s
   <serial> install -r <apk>`): every photo still shows. Note `get_app_container ... data` before and
   after: when the path changed, only MediaRefs survive it (stored URIs would not).

Say in the report that the drill is owed when no build was available.

## 4. check-media rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-media.mjs [repo-root] [--json]`; runtime files under `src/` only
(tests may simulate anything).

| Rule | Fails when | Fix |
|---|---|---|
| `image-size` | an expo-image `<Image>`/`<ImageBackground>` has no `style` (spreads trusted) | a box: width and height, or one with aspectRatio |
| `image-legacy-prop` | `resizeMode`, `defaultSource`, `loadingIndicatorSource`, `fadeDuration` on expo-image | `contentFit`, `placeholder`, `transition` |
| `image-a11y` | an expo-image `<Image>` without `accessible` (a label alone is ignored: its own message), or `accessible` without `accessibilityLabel`/`alt` | named content image, or `accessible={false}` |
| `list-recycling-key` | an expo-image `<Image>` without `recyclingKey` in a file importing `@shopify/flash-list` or a local module it imports | `recyclingKey={item.id}` or `StoredImage` |
| `picker-options` | `MediaTypeOptions`; `base64: true` or `exif: true` in a file that launches the picker or camera | `mediaTypes: ['images']`; drop base64 and EXIF |
| `picker-on-press` | `launchImageLibraryAsync`, `launchCameraAsync`, `pickImages`, `capturePhoto`, `importFromLibrary`, `importFromCamera` inside `useEffect`/`useLayoutEffect`/`useFocusEffect` | call it from a press handler; only `importPendingPick` runs at startup |
| `permission-outside-gate` | `requestCameraPermissionsAsync`, `requestMediaLibraryPermissionsAsync`, `requestMicrophonePermissionsAsync`, `use*Permissions`, or expo-media-library's `requestPermissionsAsync`/`usePermissions`, outside `src/services/permissions/` | the PermissionsPort and its gate |
| `unused-permission` | the code imports `expo-image-picker` and `cameraPermission` is not `false` while nothing opens a camera (`launchCameraAsync`, expo-image-picker's `requestCameraPermissionsAsync`/`getCameraPermissionsAsync`/`useCameraPermissions`, an `expo-camera` or `react-native-vision-camera` import, a `camera` entry in `contracts/permissions.json`, another plugin declaring one), or `microphonePermission` is not `false` while nothing records (a video media type, expo-audio's recorder, expo-camera's `recordAsync`/`mode="video"`, vision-camera's `startRecording`, a `microphone` entry in `contracts/permissions.json`, another plugin's microphone string); the picker imported but not listed (prebuild applies its defaults); expo-media-library imported or listed with `READ_MEDIA_IMAGES`/`VIDEO` kept (default `granularPermissions`, not blocked) while no code reads the library (`Query`, `getAssetsAsync`, `Album.getAll`) | set the option to `false` (it blocks the permission app-wide); list the picker; the save-only media-library config |
| `stored-uri` | a `uri` / `*Uri` / `*URI` field typed `string` or validated by `v.string()`, `v.optional(v.string())`, `v.nullable(v.string())`, `v.nullish(v.string())` in `src/data/` or `src/stores/`; a `uri`, `*_uri` or `*Uri` `TEXT` column | store a MediaRef; name server images `*Url` |
| `overwrite-in-place` | `overwrite: true` in `src/services/media-store/` | a new ref per change |
| `media-in-cache` | the media store builds a `Directory`/`File` on `Paths.cache` | `Paths.document` |
| `sweep-wired` | runtime code outside `src/data/media/` calls `createMediaImporter(` and nothing calls `sweepMedia(` | sweep after startup and after a restore |
| `data-uri` | a `data:image/...;base64,` URI in runtime code outside `src/ui/icons/` (icon masks) | a file URI; blurhash or thumbhash for placeholders |
| `legacy-api` | a throwing legacy name imported from `expo-file-system` (including `createUploadTask`, `downloadAsync`, `uploadAsync`) or `expo-media-library` (named or through a namespace), or their `/legacy` entry (kept for migration) | the object APIs (`file.createUploadTask` and `File.downloadFileAsync` are fine) |
| `transfer-outside-port` | `downloadFileAsync`, `createDownloadTask`, `createUploadTask` or `.upload(` in a file importing expo-file-system, outside `src/services/file-transfer/*-adapter.ts` | `FileTransferPort` |

Known limits (review points, not regexes to grow):

- `stored-uri` is a naming heuristic. A remote URL named `imageUri` is reported (rename it `imageUrl`);
  a URI stored under another name (`photoPath`, `fileLocation`), a quoted SQL identifier
  (`"photoUri" TEXT`), a column declared without a type, or a field typed through an alias
  (`uri: FileUri`) is not. It also matches parameter annotations, not only stored fields: a store
  action `setAvatar: (avatarUri: string | null) => void` or a data-layer method parameter `uri: string`
  is reported although nothing is stored; name the parameter `ref` (a MediaRef) or move the URI
  handling out of `src/data/` and `src/stores/`.
- `unused-permission` knows the recorders listed above. A camera or microphone used through another
  library is invisible to it: keep the picker option a string and say why in a comment. It does not
  check a picker that is listed but never imported (the reference app lists every auto-applied plugin
  on purpose), and it reads `android.blockedPermissions` only as an array literal in `app.config.ts`.
- `list-recycling-key` follows imports one level from the FlashList file and treats a file as all or
  nothing: every expo-image `<Image>` in a file that imports `@shopify/flash-list` is reported, a
  header avatar outside the list included. Give that image a `recyclingKey` too, or move it into its
  own component file. `image-a11y` cannot tell whether a label describes the image.
- `picker-on-press` reads only the direct body of an effect callback: an effect that calls a local
  helper which opens the picker (`useEffect(() => { void openPicker(); }, [])`) is not reported.
  Review effects in media models for helpers that pick.
- `transfer-outside-port` matches `.upload(` on any object in a file that imports expo-file-system, so
  an `apiClient.upload(` there is reported too: move the call out of that file, or route it through
  `FileTransferPort` if it really sends a file. A transfer through a library other than expo-file-system
  is invisible to it.
- `data-uri` skips `<uiDir>/icons/` (`src/ui/icons/`): icons-app-icon-and-splash keeps each icon there
  as a few-hundred-byte PNG mask rasterized by Skia, cached and tinted, which is not the photo bytes this
  rule is about. A photo data URI placed in that folder is not reported; keep photos out of it.

## 5. Configuration, SKIP and NOT APPLICABLE

- Layout keys read (rn-skills.config.json): `srcDir`, `uiDir`, `dataDir`, `storesDir`, `servicesDir`. The
  fixed subfolders are `<servicesDir>/media-store`, `<servicesDir>/permissions`, `<servicesDir>/file-transfer`,
  `<dataDir>/media` and `<uiDir>/icons`. `contracts/permissions.json` (permissions-and-system-prompts),
  when present, adds its `camera` and `microphone` entries to what `unused-permission` counts as used.
- `SKIP app.config.ts [unused-permission] not yet created (app-variants-and-environment creates it)`
  when the app imports expo-image-picker and has no `app.config.ts` yet.
- `NOT APPLICABLE: no source file under src/ imports expo-image, expo-image-picker, expo-camera,
  expo-image-manipulator, expo-media-library, expo-file-system, and there is no src/services/media-store/`.
- No `src/` folder is exit 2 (`nothing to check`). When multi-package, run it once per app folder.

## 6. What no checker proves

That a label describes the image well, that the share anchor is right on iPad, that a portrait photo is
upright, that the resizer output has no GPS tags, that the Android lost-activity path works, that the
app's media fits Android Auto Backup's 25 MB or is deliberately excluded. The drill (section 3) and the
review cover them.
