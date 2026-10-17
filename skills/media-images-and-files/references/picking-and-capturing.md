# Picking and capturing images (Expo SDK 57)

The photo library picker and the system camera through `MediaPickerPort`, the permissions each needs
on iOS and Android, Android's lost-activity result, what the picker returns, and the app config.
Read in the `expo-image-picker` 57.0.20 type declarations, its iOS (`ImagePickerModule.swift`,
`MediaHandler.swift`) and Android (`ImagePickerModule.kt`, `AndroidManifest.xml`) sources and its config
plugin, and the SDK 57 docs, on 2026-10-14. Re-verify: `npm view expo-image-picker@~57.0.20 version`,
https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/.

## Contents

1. Decisions
2. Install and classify
3. The port and its adapter
4. Permissions on iOS and Android
5. The camera through the permission gate
6. Android: the pick a destroyed activity lost
7. What a pick returns, and where the file lives
8. The app config: declare only what the code uses
9. An in-app camera (expo-camera), when the system UI is not enough
10. Pitfalls

## 1. Decisions

| Decision | Why |
|---|---|
| The system photo picker (`launchImageLibraryAsync`) for the library, the system camera UI (`launchCameraAsync`) for a new photo | No custom UI to build or keep accessible; the library picker needs no permission on iOS 14+ and Android |
| Behind `MediaPickerPort` (`src/services/media-picker/`), one adapter, a fake with a test | Jest never touches native code; the importer and the screens are tested with the fake |
| Images only, quality 1, no EXIF, no base64 (`picker-options`) | The resizer encodes once; EXIF can hold the GPS position; base64 puts megabytes on the JS heap |
| Pick and capture only from a press (`picker-on-press`) | A picker that opens on mount or focus surprises the person and loops after a cancel |
| The camera only after the permission gate (`permission-outside-gate`) | One explained ask on both platforms; denied vs blocked handled once (permissions-and-system-prompts) |
| Every pick goes through the media importer (`src/data/media/media-importer.ts`) | Downscale, copy into the media store, discard the temporaries: the picked file is never kept or referenced |

## 2. Install and classify

```sh
npx expo install expo-image-picker            # ~57.0.20 (SDK 57)
npx expo install expo-image-manipulator       # ~57.0.20, for the resizer adapter
```

Then stop and ask the developer to classify the SDKs (an architecture decision): merge
`examples/contracts/architecture.json` into `contracts/architecture.json` and add the packages to
`VENDOR_SDK_PATHS` in `eslint.config.mjs` in the same commit (a Gate-Change trailer). Without that,
architecture-and-boundaries' `unclassified-sdk` fails on the adapters. `expo-image` stays portless (it
renders); `expo-file-system` is a default vendor SDK.

## 3. The port and its adapter

`MediaPickerPort` (`templates/src/services/media-picker/media-picker-port.ts`):

| Method | Calls | Returns |
|---|---|---|
| `pickImages({ limit })` | `launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false, base64: false, allowsMultipleSelection: limit > 1, selectionLimit, orderedSelection: true })` | `PickedImage[]`; a cancel is `[]` |
| `capturePhoto()` | `isCameraPresent()` (injected: false on the iOS simulator), `isCameraAllowed()` (injected: the gate's access reads the state, never asks), then `launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false, base64: false })` | `PickedImage` or `null` (cancel); `permission-needed`, `camera-unavailable` |
| `recoverPendingPick()` | `getPendingResultAsync()` | the lost pick on Android, `[]` otherwise |

- `selectionLimit` is capped at `MEDIA_LIMITS.maxPickCount` (10); `0` would mean "as many as the system
  allows" and is never passed.
- `mediaTypes` takes an array of `'images' | 'videos' | 'livePhotos'`; the `MediaTypeOptions` enum is
  deprecated in 57 (`picker-options` reports it). A live photo selected with `'livePhotos'` returns the
  still plus a `pairedVideoAsset` at original quality (iOS only); the adapter asks for images only.
- `allowsEditing` (crop) is ignored on iOS when `allowsMultipleSelection` is on, and iOS crops only to a
  square; offer a crop step in the app if the design needs other shapes.
- Animated GIFs stay animated on Android only with `quality: 1` and `allowsEditing: false` (per the docs);
  the resizer turns every image into a still JPEG anyway. An app that keeps GIFs skips the resizer for
  them and stores the original (`extensionForMimeType` maps `image/gif`).

## 4. Permissions on iOS and Android

| Action | iOS | Android |
|---|---|---|
| Pick from the library | No permission (PHPicker runs out of process); `NSPhotoLibraryUsageDescription` must still be in Info.plist because the module links the photo-library authorization API | No permission (the system Photo Picker; on devices without it, Google Play services' back-port; `legacy: true` uses the document picker instead) |
| Take a photo | `NSCameraUsageDescription`; `launchCameraAsync` rejects (`MissingCameraPermissionException`) unless the permission is already granted | `CAMERA` (declared by the module's own manifest); `launchCameraAsync` asks for it itself if not granted, with no explanation first |
| Microphone | only for recording video (`NSMicrophoneUsageDescription`) | `RECORD_AUDIO`, added by the plugin unless `microphonePermission: false` |
| Read the whole library (a custom gallery) | `NSPhotoLibraryUsageDescription` + the gate's `photos` kind; "Limited" access is a result (`accessPrivileges: 'limited'`) | `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (Android 13+), partial access via `READ_MEDIA_VISUAL_USER_SELECTED` (Android 14+); **Google Play policy applies** (below) |

Rows 1-3 were read in the native sources (2026-10-14); the ITMS purpose-string requirement in row 1 is
App Store Connect behaviour reported for apps that link the API, not reproduced here. A custom gallery
(row 4) is rarely needed: the system picker already shows the person's whole library without any grant.

**Google Play's Photo and Video Permissions policy.** Play allows `READ_MEDIA_IMAGES` and
`READ_MEDIA_VIDEO` only for apps whose core feature needs broad access to the library (a gallery, a
photo editor or backup app); every other app must use the system photo picker, and an app that
declares them files a declaration in the Play Console for review. The system picker (row 1) needs
neither, so a custom gallery is a product decision with a store cost: stop and ask before adding one.
Policy text as published by Google Play (re-read the Play Console Help page "Photo and Video
Permissions" before a release); check-media's `unused-permission` reports these permissions when no
code reads the library.

## 5. The camera through the permission gate

The two platforms differ (iOS refuses, Android asks without context), so the app makes them the same:

1. The model hook holds permissions-and-system-prompts' `usePermissionGate({ access:
   services.permissions.access.camera, openSettings: services.permissions.openSettings,
   shouldExplainFirst: <the contract's value, as a literal>, onError })`. "Take photo" calls
   `gate.requestAccess(onAllowed)`, and `onAllowed` runs the capture job (`importer.importFromCamera()`).
2. The gate decides from the state read at the press: allowed → `onAllowed` at once; `ask` → the
   system dialog, then `onAllowed` if granted; `explain` (the app's sheet before the first dialog),
   `rationale` (Android's "Continue" / "No thanks" before asking again), `settings` (blocked: "Open
   Settings") and `unavailable` → the gate's `sheet`, which the screen renders with that skill's sheet
   view and wires to `confirm`, `dismiss` and `openSettings`. Never rebuild this branch in a feature:
   a hand-written ask skips Android's rationale step (`examples/src/features/tasks/`).
3. The picker adapter still checks before launching: `isCameraAllowed()`, injected by the composition
   root as `async () => isPermissionAllowed(await permissions.access.camera.permission())`. A missing
   gate is then a typed `permission-needed`, not a surprise dialog, and the adapter imports no
   permission function (permissions-and-system-prompts' adapter is their only importer, and its
   `can-ask-again` rule reads every file that maps an Expo permission answer).

Only the permissions adapter (`src/services/permissions/`) calls `requestCameraPermissionsAsync`,
`requestMediaLibraryPermissionsAsync`, `useCameraPermissions` and friends (`permission-outside-gate`).
**The iOS simulator has no camera, and opening it there crashes the app.** expo-image-picker 57.0.20's
`launchCameraAsync` (`ImagePickerModule.swift`) checks only the camera permission, which the simulator
grants, then sets `UIImagePickerController.sourceType = .camera` without `isSourceTypeAvailable`.
UIKit raises `NSInvalidArgumentException` for a source type the device lacks: an Objective-C exception,
not a rejected promise, so no `try`/`attemptAsync` can turn it into a value (read in the native source
on 2026-10-14; not reproduced on a simulator). So:

- The adapter takes `isCameraPresent: () => boolean` and answers `camera-unavailable` before it calls
  `launchCameraAsync`. The composition root binds it to `() => Platform.OS !== 'ios' || Device.isDevice`
  (`npx expo install expo-device`, SDK 57: `~57.0.2`): the Android emulator has a virtual camera, the
  iOS simulator none. A screen may also hide "Take photo" with the same function.
- Capture is tested on a device or on the Android emulator, never on the iOS simulator; there, the
  drill only checks that "Take photo" shows the camera-unavailable message (testing-and-checker.md,
  section 3).

## 6. Android: the pick a destroyed activity lost

Android may destroy the app's activity while the picker or camera is in front (low memory, or "Don't
keep activities" in developer options). The result is then lost to the promise, and
`getPendingResultAsync()` returns it once after the app is recreated. The importer's
`importPendingPick()` runs once at startup (after the data layer opened; app-startup-and-bootstrap's
startup work), stores the images, and the app shows them in the draft the person was editing (or a
"Photos added" notice when the draft is gone). iOS always returns `null`. Test it with "Don't keep
activities" on an emulator (testing-and-checker.md).

## 7. What a pick returns, and where the file lives

`ImagePickerAsset`: `uri` (file in the cache), `width`/`height` (pixels, `0` when unknown), `type`
(`'image' | 'video' | 'livePhoto' | 'pairedVideo' | null`), `mimeType`, `fileSize`, `fileName` (may be
null; never used to name anything), `assetId` (null under limited access), `exif`, `base64`, `duration`.

- **The file is a temporary.** Both platforms write it under the app's cache in an `ImagePicker` folder
  (iOS `MediaHandler.generateUrl`, Android `createOutputFile`, read in the sources). The system may
  purge the cache when storage runs low; the importer copies a downscaled version into the media store
  and discards the original right away (files-and-storage.md).
- **HEIC.** iOS may return HEIC (the default `Automatic` representation passes it through). The resizer
  re-encodes to JPEG, which every server, browser and older Android reads.
- **Orientation.** Pixels may carry an EXIF orientation; iOS fixes orientation for the camera
  (`UIImage+fixOrientation.swift`) and the manipulator reads local files keeping it, so the re-encoded
  JPEG is upright (read in the sources; check portrait photos in the drill).
- **Location.** With `exif: false` JS never sees EXIF; the re-encode writes no EXIF block, so the stored
  and shared file carries no GPS position (rule 7, sharing-and-transfer.md).

## 8. The app config: declare only what the code uses

`expo-image-picker` is applied by prebuild even when `app.config.ts` does not list it (it is one of
`@expo/prebuild-config`'s legacy auto-applied plugins), with English default purpose strings, the camera
and `RECORD_AUDIO`; `npx expo install` cannot add the entry to a dynamic `app.config.ts`, so list it by
hand (expo-prebuild-and-config-plugins' `auto-plugin-listed` owns listing it). This skill owns the
options: check-media's `unused-permission` reads the entry and the code together, and reports a picker
the code imports but the config does not list.

```ts
[
  'expo-image-picker',
  {
    photosPermission: sourceText(projectRoot, 'permissions.photos.usage-description'),
    cameraPermission: sourceText(projectRoot, 'permissions.camera.usage-description'), // or false
    microphonePermission: false,                                                      // unless video
  },
],
```

- **These options act on the whole app, not on the picker.** `cameraPermission: false` deletes
  `NSCameraUsageDescription` from Info.plist and calls `withBlockedPermissions(['android.permission.CAMERA'])`,
  which writes `tools:node="remove"` for `CAMERA` into the merged manifest: no package can declare it
  any more. `microphonePermission: false` does the same to `NSMicrophoneUsageDescription` and
  `RECORD_AUDIO` (read in the expo-image-picker 57.0.20 plugin, `withImagePicker.js`).
- Nothing opens a camera → `cameraPermission: false`. "A camera" is `launchCameraAsync`, any
  `expo-camera` or `react-native-vision-camera` import, or another plugin that declares one
  (`['expo-camera', { cameraPermission }]`). An app with an expo-camera scanner keeps the picker's
  camera string even if the picker itself never opens the camera.
- Nothing records sound → `microphonePermission: false`. "Records" is a `'videos'`/`'livePhotos'`
  media type, expo-audio's recorder (`useAudioRecorder`, `requestRecordingPermissionsAsync`),
  expo-camera's video (`recordAsync`, `mode="video"`), vision-camera's `startRecording`, or another
  plugin that declares the microphone (`microphonePermission: '...'`, `recordAudioAndroid: true`).
- check-media counts all of these as use; a recorder it does not know (another library) needs the
  option left as a string, and the reviewer checks the merged manifest after prebuild
  (expo-prebuild-and-config-plugins' native snapshot).
- The texts come from the catalogs (i18n-strings-and-catalogs owns `sourceText` and the translated
  purpose strings); privacy-and-store-declarations owns the store answers ("Photos or Videos").

## 9. An in-app camera (expo-camera), when the system UI is not enough

`expo-camera` (`~57.0.6`) renders a live viewfinder (`CameraView`) for barcode scanning or a custom
overlay. Use it only when the system camera UI cannot do the job. If it is used:

- classify it as a vendor SDK behind a `CameraPort`; the view itself is rendered by one feature
  component and receives the permission state from the gate;
- render `CameraView` only while the screen is focused and the app is active (`useIsFocused`,
  react-components-and-hooks' `useIsAppActive`): a mounted camera keeps the hardware on and the
  privacy indicator lit;
- its plugin has its own `cameraPermission`, `microphonePermission` and `recordAudioAndroid` options:
  `false` for what the app never records; and expo-image-picker's `cameraPermission` must stay a
  string, because `false` there removes `CAMERA` for the whole app (section 8);
- a photo it takes is a temporary like a picked one: through the resizer and the media store.

## 10. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| "Missing camera permission" on iOS, a system dialog out of nowhere on Android | `launchCameraAsync` without the gate | the gate first; the adapter answers `permission-needed` |
| The app crashes (`NSInvalidArgumentException`, source type not available) on "Take photo" in the iOS simulator | `launchCameraAsync` reached UIKit on a device without a camera | inject `isCameraPresent` (section 5); test capture on a device or the Android emulator |
| The picker opens again right after it was cancelled | it was launched from an effect | a press handler (`picker-on-press`) |
| Photos vanish from records days later | the record kept the picker's cache URI; the system purged the cache | import into the media store; store the MediaRef (`stored-uri`) |
| The app freezes or dies after picking 10 photos | `base64: true`, or the images decoded in parallel | no base64 (`picker-options`); the importer goes one at a time |
| Play Console lists a microphone permission the app never uses | the plugin's default `RECORD_AUDIO` | `microphonePermission: false` (`unused-permission`) |
| The expo-camera scanner (or the voice-note recorder) can never get its permission on Android | the picker's `cameraPermission: false` (or `microphonePermission: false`) removed it from the merged manifest | keep the option a catalog string while any feature uses it |
| Play asks for a Photo and Video Permissions declaration | `READ_MEDIA_IMAGES`/`VIDEO` declared (expo-media-library defaults) without a gallery feature | the system picker; save-only config (sharing-and-transfer.md, section 3) |
| A picked image never arrives on some Android phones | the activity was destroyed while the picker was open | `importPendingPick()` at startup |
| A server rejects uploads from iPhones | HEIC | the resizer re-encodes to JPEG |
