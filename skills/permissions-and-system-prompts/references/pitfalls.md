# Pitfalls: symptom, cause, fix

## Contents

1. Crashes and dead ends
2. Dialogs that do not appear, or appear too often
3. States that lie
4. Review and store trouble
5. Test trouble

## 1. Crashes and dead ends

| Symptom | Cause | Fix |
|---|---|---|
| iOS app quits the moment the person taps "Take photo" | no `NSCameraUsageDescription` in the build: the plugin option is `false`, missing, or `ios/` predates it | give the option `sourceText(projectRoot, 'permissions.camera.usage-description')`, `npx expo prebuild --clean`, regenerate the native snapshot (`purpose-string`) |
| Android camera request answers "denied" at once, no dialog, on every phone | `CAMERA` removed from the manifest: `android.blockedPermissions` or expo-image-picker's `cameraPermission: false` | remove the block (`android-blocked`); `false` is only for permissions the app never asks |
| "Another permissions request is in progress" in the error log | two requests overlapped (a double tap, two features asking on one screen) | ask through `usePermissionGate`, which runs one ask at a time and disables the control (`isAsking`) |
| Blocked people are stuck: the button does nothing | the app re-requests a blocked permission (resolves at once) and shows nothing | map `canAskAgain` (`toPermissionState`), show the settings sheet, open `Linking.openSettings()` (`can-ask-again`, `open-settings`) |
| The app crashes when "Take photo" runs on the iOS simulator | expo-image-picker 57.0.20's `launchCameraAsync` checks only the permission (the simulator grants it) and then opens `UIImagePickerController` with the camera source without an availability check; UIKit raises an Objective-C exception, not a rejected promise (read in source, not run) | check camera presence before launching (media-images-and-files' picker adapter takes `isCameraPresent`); test camera features with the fake and on a device; the library picker works on a simulator |

## 2. Dialogs that do not appear, or appear too often

| Symptom | Cause | Fix |
|---|---|---|
| The system dialog never shows in E2E | Maestro's `launchApp` grants every permission by default | `launchApp: { clearState: true, permissions: { all: unset } }` or `camera: deny` |
| The dialog shows on first launch before anything is on screen | a request in the root layout, an effect or module scope | ask from the press (`ask-from-action`) |
| Android shows the dialog only once, then "blocked" after a dismissal | Expo decides "blocked" from `shouldShowRequestPermissionRationale()` right after a non-grant, which is false after dismissing the very first dialog (read in source) | accept it: the settings sheet appears on the next press and Settings works; do not keep your own counters |
| Android 13+ never shows the notification dialog | already blocked (second refusal), never requested from a press, or (targetSdk 12L or lower) no channel exists yet | the settings sheet on `blocked`; ask from the press; create channels first (`push-notifications`, `local-notifications`) |
| "Allow all the time" never offered on Android | background location requested together with foreground, or without `isAndroidBackgroundLocationEnabled` | foreground first, background later in its own step; enable the plugin option (`location-foreground-first`) |
| The photos permission dialog appears just to pick one image | the code requests the media-library permission before `launchImageLibraryAsync` | drop it: the system picker needs no permission (`picker-no-permission`) |

## 3. States that lie

| Symptom | Cause | Fix |
|---|---|---|
| "Camera access is off" stays after the person turned it on in Settings | the state was read once (a `useState` + effect, a store) | read it through the status mirror, which re-reads on every return to the foreground (`recheck-on-active`) |
| People who chose "Select Photos" are told they refused | `limited` mapped to denied (only `granted` read) | map `accessPrivileges === 'limited'` to `limited`, an allowed state (`photos-limited`) |
| Approximate-location users see "location off" | `android.accuracy 'coarse'` / `ios.accuracy 'reduced'` treated as a refusal | `limited` is allowed; ask for precision only where the feature needs it |
| A screen flickers or resets when the iOS alert shows | the app treats `inactive` as leaving the app | pause on `background`, not `inactive`; the alert makes the app `inactive` |
| After an update everyone sees the dialog again | the app reinstalled (both OSes forget answers) or Android auto-reset permissions of an unused app | expected: the flow handles it like a first ask |

## 4. Review and store trouble

| Symptom | Cause | Fix |
|---|---|---|
| App Review rejects under 5.1.1 for a vague purpose string | "Allow Tasks to access your camera" (a plugin default) or "needed for a better experience" | one active sentence: what the feature does with it and where the data goes, in every language (`asking-flow.md` section 13) |
| Rejection for a pre-permission screen | the explain sheet has "Allow", a close or "Not now" button, an incentive, or a picture of the alert | one "Continue" button, no other action (`asking-flow.md` section 4) |
| App Review asks why the app requests the microphone | a plugin's default added `NSMicrophoneUsageDescription` and `RECORD_AUDIO` the app never uses | `microphonePermission: false` (expo-image-picker), `recordAudioAndroid: false` (expo-camera) |
| Play Console asks for a background-location declaration | `ACCESS_BACKGROUND_LOCATION` in the manifest | keep it only when a feature truly needs it; fill the declaration (`android-release-play`) |
| Store privacy answers do not match what the app collects | a new permission landed without a contract entry | `undeclared-permission`; then update the declarations (`privacy-and-store-declarations`) |

## 5. Test trouble

| Symptom | Cause | Fix |
|---|---|---|
| A model test passes but the dialog count is wrong on Android | the fake was scripted for iOS | write the Android case with `platform: 'android'` (two dialogs, `denied` between them) |
| The gate test sees the old sheet | the press was not awaited inside `act` | `await act(async () => { gate.requestAccess(fn); await Promise.resolve(); })` |
| `vendor-sdk-import` from unit-and-component-tests in an adapter test | the test imports the module itself | `jest.mock('<module>')` + a typed `jest.requireMock` over the root mock |
| Revoking on the emulator kills the test app | Android ends the process on every revocation | revoke before launch, then `launchApp` |
