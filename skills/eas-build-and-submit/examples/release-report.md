# Example: the messages of one EAS release (Tasks app)

Shapes to imitate, not to copy. The numbers, ids and hashes are invented.

## 1. Asking before the store build

> Tasks 1.4.0 is ready for a store build: commit 9c41e2d on main, `npm run verify` green, the release
> preflight passed (fingerprints ios 74196b1b, android 0daa7d46). With your yes I run
> `eas build --profile production --platform all --non-interactive --freeze-credentials --message 'feat(tasks): due dates'`,
> check both build records, gate both downloaded binaries, then submit exactly those files: iOS to
> TestFlight (What to Test: "Due dates on the task list and in reminders") and Android to the internal
> track. Until you answer, nothing is built.

## 2. The evidence after the submission

```
Evidence: Tasks release 1.4.0 on 2026-10-14, commit 9c41e2d
- Gates: check-eas-config --release RESULT: PASS; release-preflight ready (verify green)
- iOS: build 0b6f7c2e (appBuildVersion 14), check-eas-build RESULT: PASS, check-store-artifact on
  build/ios-release/export/app.ipa RESULT: PASS, submitted with --path to TestFlight, processing
  finished; tag v1.4.0+ios.14
- Android: build 7d1e0f9a (versionCode 31), check-eas-build RESULT: PASS, check-store-aab on
  build/release-android/app-release.aab RESULT: PASS, submitted with --path to the internal track
  (completed); tag v1.4.0+android.31
- Fingerprint: equal to the preflight on both platforms (the binaries hold the reviewed native inputs)
- Not tested: external TestFlight (needs Beta App Review)

Please say "ship" when 1.4.0 may go to review. Until then it stays in testing.
```

## 3. A stop

> iOS, eas submit: `Error: The app with bundle identifier com.example.tasks was not found in App Store
> Connect` (ascAppId 6740000000). Please create the app record for com.example.tasks in App Store Connect
> (about 5 minutes) and tell me its Apple ID number. Until then build 14 stays unsubmitted; the Android
> submission is done.

## Bad versions, and why

- "Uploaded to TestFlight!" right after `eas build` returned: the record was not checked and processing
  had not finished.
- "Build failed with a credentials error, so I switched the profile to local credentials and built
  again": a stop was worked around, and a key file was handled.
- "Submitted with `eas submit --latest`": the build that finished last may be a preview build or another
  branch's.
