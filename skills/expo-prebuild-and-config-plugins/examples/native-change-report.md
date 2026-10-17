# Example: the evidence for one native change

The shape of the report after a native change in a Tasks app: attaching photos to a task with
`expo-image-picker`, which was installed but not listed (so prebuild applied it with Expo's
defaults). Real output from a copy of the reference app with this skill adopted (2026-10-04), shortened.

## What changed

- `expo-image-picker` was already a dependency (dependency-management installs packages).
- The other auto-applied packages the app installs (`expo-apple-authentication`,
  `expo-notifications`, `expo-document-picker`, `expo-file-system`, `expo-task-manager`,
  `expo-dev-client`) were already listed with their options by an earlier change, so
  `auto-plugin-listed` had only `expo-image-picker` left to report.
- `app.config.ts`: `['expo-image-picker', { photosPermission, cameraPermission, microphonePermission: false }]`
  (the app never records sound; `false` also blocks `RECORD_AUDIO`), and
  `['./plugins/with-android-optional-features.ts', { features: ['android.hardware.camera', 'android.hardware.camera.autofocus'] }]`
  (the CAMERA permission would otherwise make Google Play hide the app from camera-less devices).
- `plugins/with-android-optional-features.ts` and its test (from the skill's template),
  `test/config-plugins/run-mod.ts` and its test.

## Proof

```text
$ npx jest --ci --selectProjects unit --runTestsByPath plugins/with-android-optional-features.test.ts test/config-plugins/run-mod.test.ts
Tests:       12 passed, 12 total

$ APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo config --type introspect --json
... "uses-feature":[{"$":{"android:name":"android.hardware.camera","android:required":"false"}},
                     {"$":{"android:name":"android.hardware.camera.autofocus","android:required":"false"}}]

$ npx expo prebuild --clean --no-install --platform android && npx expo prebuild --no-clean --no-install --platform android
$ grep -n uses-feature android/app/src/main/AndroidManifest.xml
8:  <uses-feature android:name="android.hardware.camera" android:required="false"/>
9:  <uses-feature android:name="android.hardware.camera.autofocus" android:required="false"/>

$ node ${CLAUDE_SKILL_DIR}/scripts/check-native-snapshot.mjs .
FAIL contracts/native-config.json:43 [native-drift] ios.infoPlist.NSCameraUsageDescription: changed from "Allow $(PRODUCT_NAME) to access your camera" to "Tasks attaches the photos you take to a task." ...
FAIL contracts/native-config.json:45 [native-drift] ios.infoPlist.NSMicrophoneUsageDescription: removed (was "Allow $(PRODUCT_NAME) to access your microphone") ...
FAIL contracts/native-config.json:46 [native-drift] ios.infoPlist.NSPhotoLibraryUsageDescription: changed from "Allow $(PRODUCT_NAME) to access your photos" to "Tasks attaches the photos you pick to a task." ...
FAIL contracts/native-config.json:83 [native-drift] android.features: added "android.hardware.camera required=false" ...
FAIL contracts/native-config.json:83 [native-drift] android.features: added "android.hardware.camera.autofocus required=false" ...
FAIL contracts/native-config.json:93 [native-drift] android.permissions: added "android.permission.RECORD_AUDIO tools:node=remove" ...
FAIL contracts/native-config.json:93 [native-drift] android.permissions: removed "android.permission.RECORD_AUDIO" ...
check-native-snapshot: 1 snapshots checked, 7 problems
RESULT: FAIL (7 problems)
$ node ${CLAUDE_SKILL_DIR}/scripts/check-native-snapshot.mjs . --write     # intended: the snapshot diff goes into this commit
RESULT: PASS

$ node ${CLAUDE_SKILL_DIR}/scripts/check-native-generation.mjs .
check-native-generation: 33 files checked, 0 problems
RESULT: PASS
```

## For the reviewer

- Native surface changed (from the snapshot diff): Expo's generic English purpose strings replaced by
  the app's words; the microphone string gone and `RECORD_AUDIO` blocked (`tools:node="remove"`);
  two optional Android features added.
- Not covered by this proof: permissions that the library's own `AndroidManifest.xml` adds at Gradle
  merge time (`CAMERA` and the storage permissions with `maxSdkVersion="32"` come from
  expo-image-picker's manifest). The next emulator build (android-emulator-build) reads the
  merged manifest; privacy-and-store-declarations updates the Data safety answers.
- Purpose-string wording and translations: permissions-and-system-prompts.
