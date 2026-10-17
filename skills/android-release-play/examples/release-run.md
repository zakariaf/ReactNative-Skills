# A release run (Tasks app, EAS lane)

One release of the Tasks app, version 1.4.0, from a green commit to the internal track and then a
staged rollout. The outputs are shortened; the shape is what to imitate.

## 1. Setup check

```text
$ node <skill>/scripts/check-play-release-setup.mjs . --release
check-play-release-setup: 1 release setup checked, 0 problems
RESULT: PASS
```

## 2. Build (EAS) and download the exact bundle

```text
$ eas build --platform android --profile production --non-interactive --freeze-credentials --message 'feat(tasks): due dates' --json > dist/eas/builds.json
✔ Build finished
$ node <eas-build-and-submit>/scripts/check-eas-build.mjs . --build dist/eas/builds.json --platform android
check-eas-build: 1 build records checked, 0 problems
RESULT: PASS
$ jq -r '.[0] | .id, .appBuildVersion, .artifacts.applicationArchiveUrl' dist/eas/builds.json
6f1c...
31
https://expo.dev/artifacts/eas/....aab
$ curl -fsSL -o build/release-android/app-release.aab "https://expo.dev/artifacts/eas/....aab"
```

## 3. The gate, first a failure

```text
$ node <skill>/scripts/check-store-aab.mjs . --aab build/release-android/app-release.aab --version-code 31 --stamp build/release-android/aab-gate.json
FAIL build/release-android/app-release.aab!base/manifest/AndroidManifest.xml [permissions] uses-permission android.permission.READ_MEDIA_IMAGES is not in the contract Fix: Find who adds it (the merged manifest); block it with android.blockedPermissions, or list it in contracts/android-release.json permissions with the reason. A new permission changes the Data safety answers.
check-store-aab: 1 bundle (versionCode 31) checked, 1 problems
RESULT: FAIL (1 problems)
```

The image picker added the permission. The app only picks single photos, so the system photo picker
is enough: block the permission, commit, build again (versionCode 32), gate again:

```text
$ node <skill>/scripts/check-store-aab.mjs . --aab build/release-android/app-release.aab --version-code 32 --stamp build/release-android/aab-gate.json
stamp written: build/release-android/aab-gate.json (sha256 3b0e...)
check-store-aab: 1 bundle (versionCode 32) checked, 0 problems
RESULT: PASS
```

## 4. Ask, then submit the gated file

The message to the developer:

> Tasks 1.4.0 (versionCode 32) passed the store gate (RESULT: PASS, stamp sha256 3b0e...). May I
> submit it to the internal track? Default: no upload until you say "upload".

After "upload":

```text
$ shasum -a 256 build/release-android/app-release.aab   # equals the stamp
$ eas submit --platform android --profile production --path build/release-android/app-release.aab --non-interactive
✔ Submitted to Google Play (internal)
$ git tag -a v1.4.0+android.32 -m "Google Play build 32 (internal)"
```

## 5. Staged rollout (later, each step with its own word)

The developer installed build 32 from the internal track, then promoted it in Play Console at 5 %.
Two days later the crash-free rate is 99.8 % and the reviews are quiet; the developer raises it to
20 %. On the local lane the same steps are
`npm run release:android -- rollout --version-code 32 --fraction 0.05` and `--fraction 0.2`.

## 6. The report

```text
Android release: Tasks 1.4.0 (versionCode 32), internal track
Evidence: check-store-aab RESULT: PASS (stamp sha256 3b0e...), eas submit succeeded
Tag: v1.4.0+android.32 (local; push with your word)
Human checks (not blocking): install from the internal track; purchase test as a license tester;
TalkBack pass; en and ar
Question: promote to production at 5 %?
```
