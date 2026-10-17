# iOS and Android behaviour, permission by permission

What each OS does with a permission request, and how Expo SDK 57 reports it. Facts marked **(source)**
were read in the published packages on 2026-10-14 (expo-modules-core 57 `PermissionsService.kt`,
expo-image-picker 57.0.20 native modules and plugin, expo-location 57.0.21, expo-media-library 57.0.5,
expo-camera 57.0.6, `@expo/config-plugins` `ios/Permissions.js` and `android/Permissions.js`), facts
marked **(docs)** come from Apple's and Google's pages named in `asking-flow.md`, and facts marked
**(not verified)** are known behaviour this skill has not reproduced. Re-verify with
`npm pack <pkg>@sdk-57` and a read of `build/*.d.ts`, `plugin/build/*.js` and the native sources.

## Contents

1. How Expo answers (`PermissionResponse`)
2. How many dialogs: iOS once, Android twice
3. When a permission changes behind the app's back
4. Per permission
5. Notifications
6. Requests that fail instead of answering
7. Platform quirks worth a test

## 1. How Expo answers (`PermissionResponse`)

Every Expo module answers with expo-modules-core's `PermissionResponse`:
`{ status: 'granted' | 'denied' | 'undetermined', granted: boolean, canAskAgain: boolean, expires: 'never' | number }`,
plus module fields (`accessPrivileges` for photos, `ios.scope`/`ios.accuracy` and `android.accuracy`
for location, `ios.status` for notifications). `PermissionStatus` is re-exported by the `expo`
package (`import { PermissionStatus } from 'expo'`) **(source)**.

- `status: 'denied'` alone does not say whether the dialog can appear again. `canAskAgain` does:
  false means blocked. `toPermissionState` maps exactly this.
- Android computes it **(source)**: `undetermined` until Expo has asked once (it records asked
  permissions in its own SharedPreferences), then `denied`; after a refusal Expo stores "blocked" when
  `shouldShowRequestPermissionRationale()` turned false, and every later read reports
  `canAskAgain: false` until a grant clears it.
- iOS: a refusal is final; Expo reports `denied` with `canAskAgain: false` **(source, docs)**.

## 2. How many dialogs: iOS once, Android twice

| | iOS | Android 11+ |
|---|---|---|
| First request | the system alert | the system dialog |
| After "Don't Allow" / "Don't allow" | blocked: no more alerts | `denied`: one more dialog allowed |
| After a second refusal | — | blocked: "the user will no longer see the system permissions dialog if your app requests that permission again" **(docs)** |
| Dismissing without a choice | an alert cannot be dismissed | back or a tap outside closes the dialog; Android does not count it as a refusal **(not verified)** |
| Way back from blocked | Settings > the app | Settings > Apps > the app > Permissions |
| Reset for testing | delete the app, or `xcrun simctl privacy <udid> reset all <bundle-id>` | uninstall, or `adb -s <serial> shell pm clear <package>` |

The Android dismiss case has an Expo consequence worth knowing: Expo decides "blocked" from
`shouldShowRequestPermissionRationale()` right after a non-grant **(source)**, and that value is false
after a dismissal of the very first dialog, so Expo may report `blocked` too early. The app shows the
settings sheet on the next press; Settings still works. Do not try to outsmart it with your own
counters: Android's rules changed across versions and Expo's cache is the one source of truth.

## 3. When a permission changes behind the app's back

- **The person changes it in Settings.** iOS ends the app's process after some privacy changes
  ("Some permission changes will terminate the application if running", `xcrun simctl help privacy`),
  Android whenever a permission is revoked **(docs)**. A grant does not reliably restart anything:
  the status mirror re-reads on every return to the foreground.
- **Android one-time permissions** ("Only this time", Android 11+ for location, microphone and camera):
  the grant ends some time after the app leaves the foreground; the next read says `undetermined`
  or `denied` again **(docs)**.
- **Android auto-reset**: an app unused for a few months loses its runtime permissions (targetSdk 30+)
  **(docs)**. The person meets the dialog again; the flow handles it like a first ask.
- **Reinstall**: both OSes forget every answer. On Android, `pm clear` also clears Expo's asked/blocked
  cache, because it lives in the app's SharedPreferences **(source)**.

## 4. Per permission

| Kind | iOS key (purpose string) | Android permission | Notes |
|---|---|---|---|
| camera | `NSCameraUsageDescription` | `CAMERA` | expo-image-picker's `launchCameraAsync` rejects without the grant on both platforms (`MissingCameraPermissionException` on iOS, `ensureCameraPermissionsAreGranted` on Android) **(source)**; one-time grants on Android 11+. With expo-camera's `CameraView`, bind the adapter to `Camera.getCameraPermissionsAsync` / `Camera.requestCameraPermissionsAsync` (`import { Camera } from 'expo-camera'`: exported in 57.0.6 but `@hidden` in the docs, so re-verify on each SDK), never `useCameraPermissions`; expo-image-picker's pair asks for the same OS permission |
| microphone | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` | expo-image-picker and expo-camera add it by default; turn it off when the app never records (`microphonePermission: false` in expo-image-picker also blocks `RECORD_AUDIO`; expo-camera has `recordAudioAndroid: false`) **(source)** |
| photos (read) | `NSPhotoLibraryUsageDescription` | `READ_MEDIA_IMAGES` (+ `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED` on 34+) | only for browsing the library (expo-media-library). **Picking one photo needs no permission**: `launchImageLibraryAsync` opens the system picker without any permission check (iOS PHPicker, Android photo picker) **(source)**. Partial access: `accessPrivileges: 'limited'` on iOS 14+ and Android 14+ |
| photos-add | `NSPhotoLibraryAddUsageDescription` | none on Android 10+ | saving into the library: expo-media-library `requestPermissionsAsync(true)` (write-only) |
| location | `NSLocationWhenInUseUsageDescription` | `ACCESS_COARSE_LOCATION` (+ `ACCESS_FINE_LOCATION`) | the person may grant approximate only (iOS 14+ "Precise" off, Android 12+ "Approximate"): `ios.accuracy 'reduced'`, `android.accuracy 'coarse'` → `limited` |
| location-background | `NSLocationAlwaysAndWhenInUseUsageDescription` | `ACCESS_BACKGROUND_LOCATION` (only when `isAndroidBackgroundLocationEnabled`) | always a second, separate step after foreground: Android 11+ sends the person to Settings for "Allow all the time"; iOS grants When In Use first and may offer Always later. Play requires a declaration form for background location |
| contacts | `NSContactsUsageDescription` | `READ_CONTACTS` (expo-contacts adds `WRITE_CONTACTS` too) | iOS 18 adds limited contact access (`contacts-limited` in `simctl privacy`) |
| calendar | `NSCalendarsFullAccessUsageDescription` (iOS 17+; `NSCalendarsUsageDescription` for older) | `READ_CALENDAR`, `WRITE_CALENDAR` | write-only access exists on iOS 17+ (`NSCalendarsWriteOnlyAccessUsageDescription`) |
| reminders | `NSRemindersFullAccessUsageDescription` (iOS 17+) | — | iOS only |
| motion | `NSMotionUsageDescription` | `ACTIVITY_RECOGNITION` | expo-sensors' Pedometer, expo-location's motion activity |
| notifications | none | `POST_NOTIFICATIONS` (Android 13+) | see section 5 |
| bluetooth | `NSBluetoothAlwaysUsageDescription` | `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` | third-party modules; no Expo module |

The iOS rule that makes purpose strings non-negotiable: an app that touches a protected API without
the key is terminated by the OS (Apple's text for `NSUserTrackingUsageDescription`: "Your app crashes
if it attempts to use the framework without including the key"); App Store Connect also rejects an
upload whose binary references such an API without the key (ITMS-90683, **not verified** here).

## 5. Notifications

`push-notifications` and `local-notifications` own the notification flow; the facts that matter to the
asking flow:

- An app targeting Android 13+ (33+, the canonical 36) shows the notification dialog when it
  requests `POST_NOTIFICATIONS`; one targeting 12L or lower gets the dialog from the system only
  after its first channel exists. Both skills create channels first anyway (Android issues no push
  token before a channel exists).
- iOS can grant `provisional` authorization without a dialog (`allowProvisional: true`): notifications
  arrive quietly in Notification Center; it counts as allowed.
- iOS shows its notification alert once; Android follows the twice rule.
- `Linking.openSettings()` opens the app's page on both platforms, where the notification switch is.

## 6. Requests that fail instead of answering

A request rejects (and `createExpoPermissionAccess` turns it into `unavailable` plus an error-log
entry) when:

- the iOS purpose string is missing: the app is terminated, or the module rejects first (expo-tracking
  -transparency calls `RCTFatal`; other modules vary) **(source for ATT)**;
- a second Android request starts while one is open ("Another permissions request is in progress")
  **(source)**;
- the module is not in the build (a JS update shipped a call to a module the binary lacks:
  `ota-updates` forbids it);
- the permission is not in the merged Android manifest (blocked with `tools:node="remove"`): the
  request resolves `denied` without a dialog **(source: Android grants nothing absent from the
  manifest; Expo reports the refusal)**.

## 7. Platform quirks worth a test

- iOS moves the app to `inactive` while its alert is up. A screen that pauses work or locks itself on
  `inactive` flickers or loses its state behind a permission alert.
- iOS simulators have no camera: `launchCameraAsync` fails there whatever the permission. Test the
  ask flow with the fake and on a device; on a simulator test only the photo picker.
- Maestro's `launchApp` grants every permission by default ("By default, all permissions are
  allowed"): a flow that must see the app's sheets passes `permissions: { all: unset }` or
  `camera: deny` (see `testing-permissions.md`).
- Android's back gesture closes the app's sheets: the explain sheet's single-button rule is about
  buttons the app draws, not the system gesture.
