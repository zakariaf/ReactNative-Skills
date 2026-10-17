# The EAS lane to TestFlight, and the Android counterpart

EAS Build and EAS Submit are the default lane: no local key, no Xcode on the release machine, credentials managed by EAS. `eas-build-and-submit` owns `eas.json`, the profiles and `eas credentials`; this page is what stays this skill's job on that lane: the bundle ids per variant, the build numbers, the store-artifact gate on the `.ipa`, waiting for `VALID`, the tags and the human steps. Verified on 2026-10-14 against the EAS CLI reference (docs.expo.dev/eas/cli) and the app versions guide (docs.expo.dev/build-reference/app-versions); re-verify there before relying on a flag.

## Contents

- The lane in order
- Getting the .ipa for the gate
- Build numbers on EAS
- Waiting for processing and the tags
- What stays the same
- The Android counterpart

## The lane in order

`eas-build-and-submit`'s store release is the one truth for this order (its runbook and its release preflight print these exact lines); this skill adds the gate between the record check and the submit:

```sh
eas build --profile production --platform ios --non-interactive --freeze-credentials --message '<commit subject>' --json > dist/eas/builds.json   # only with the developer's word
node <eas-build-and-submit>/scripts/check-eas-build.mjs . --build dist/eas/builds.json --platform ios
curl -fsSL -o build/ios-release/export/app.ipa "<the record's artifacts.applicationArchiveUrl>"
node <skill>/scripts/check-store-artifact.mjs . --ipa build/ios-release/export/app.ipa --variant production --version 1.4.0 --build <n>
eas submit --profile production --platform ios --path build/ios-release/export/app.ipa --non-interactive --what-to-test "<text>"   # only with the developer's word
```

1. **Build** (never `--auto-submit` on this lane: the gate must run before anything is uploaded).
2. **Check the record** with `eas-build-and-submit`'s `check-eas-build`: it proves which commit, profile and build number EAS built; the gate cannot see that.
3. **Download the `.ipa`** from the record's artifact URL (`artifacts.buildUrl` or `artifacts.applicationArchiveUrl` in `eas build:view <id> --json`); `eas build:download` fetches simulator builds only.
4. **Gate the `.ipa`** with this skill's `check-store-artifact`: it proves what is inside the binary; the record cannot see that.
5. **Submit the gated file** with `--path`, so the bytes that passed the gate are the bytes Apple gets: the library's one submit form (eas-build-and-submit and android-release-play name the same command). `--id <build id>` would send EAS's copy of the artifact, the same file only as long as nothing changed in between. Never `--latest`, and `--auto-submit` (`eas build`) only when the developer explicitly agreed to skip the record check and this gate before the upload. `--what-to-test` sets the TestFlight text. The submit profile's `ascAppId` and `bundleIdentifier` name the app record; a preview build needs its own record and its own submit profile when it goes to TestFlight.

Verified on 2026-10-14 against the EAS CLI reference: `eas submit` takes `--path` (".ipa file"), `--id`, `--what-to-test` and `--non-interactive`; `eas build:download` is for simulator/emulator builds.

**A local EAS build** (`eas build --profile production --platform ios --local --output build/ios-release/export/app.ipa`) runs the same build on this Mac with EAS-managed credentials: useful when cloud minutes are short; it is still an EAS build (remote versioning, EAS credentials). When it leaves no build record to check, the report says so under "Not tested or not verified". Never run `eas build` without `--local` or `eas submit` against a real project without the developer's word: both leave the machine.

## Getting the .ipa for the gate

The gate needs the repo the build came from (the contract, the Xcode pin, the sentinels): run it from the repo root at the commit EAS built (the build's page and `eas build:view <id> --json` name its commit). The Xcode pin must match the image of the build profile (`ios.image` in `eas.json`, or the default image of the SDK); when they differ on purpose, pass `--xcode <version>` and say so in the report.

## Build numbers on EAS

One lane per app record, one counter per lane:

- **EAS** means remote versions (`eas-build-and-submit` rule 3): `"cli": { "appVersionSource": "remote" }`, `"autoIncrement": true` on the store profile, and no `ios.buildNumber` in the app config. EAS stores and increments the number on its servers ("the build version values stored in app config are ignored and not updated when the version is incremented remotely").
- **The local lane** means the one `IOS_BUILD_NUMBER` line in `app.config.ts`, bumped and committed by `release:ios`.

`check-release-setup` rule `version-source` enforces the split: it fails `appVersionSource: "remote"` beside `release:ios`, because two counters for one app record collide (ITMS-90189).

**EAS for internal builds, the local lane for the store.** A common mixed setup: dev clients and preview builds on EAS, store builds with `release:ios`. Then the local lane owns the counter and the version fields: `eas.json` has no store-distribution profile and no `submit` block, `cli.appVersionSource` is `"local"` (or unset), and the app config keeps `const IOS_BUILD_NUMBER = <n>;`. `check-release-setup` judges the local lane as usual; `eas-build-and-submit`'s `check-eas-config` sees no store profile next to the `release:ios` script, prints an `internal-only EAS` note and leaves `version-source`, `store-profile`, `config-versions`, `submit-profile` and `release-preflight` to this skill (its `--release` fails there, because nothing ships through EAS). Internal EAS builds then take their build number from the app config, which only the local release raises.

On EAS:

- read the build number the build reported (the record's `appBuildVersion`) and pass it as `--build`;
- `eas build:version:get -p ios -e production` prints the current remote value; `eas build:version:set` changes it (a human decision, outward-facing: never lower it).

## Waiting for processing and the tags

`eas submit` returns when the upload to App Store Connect is done; Apple's processing follows (minutes, sometimes an hour). Without the local key the agent cannot poll the REST API: ask the developer to confirm the build shows in the TestFlight tab (or wait for Apple's "has completed processing" email), and only then report "available in TestFlight". With the local key present, `node scripts/asc/print-app-record.ts` and the processing poll work for EAS-built uploads too.

Tag per platform, annotated, after `VALID`: `git tag -a v1.4.0+ios.<n> -m "App Store build <n>"` on the commit EAS built (no release commit: the number lives remotely). Release tag on "ship" as on the local lane.

## What stays the same

On EAS these rules of the skill apply unchanged: 1 (the developer's word before building for the store or submitting), 2 (no key material in the repo; `credentials.json` is git-ignored and denied to the agent), 4 (one counter: here the remote one), 5 to 10 (one known commit after the verify gate, preview builds internal-only, the gate on every `.ipa`, `VALID` before "available", stops never retried, tags), and 12 to 16 (nothing unfinished, no placeholder, usage strings in every language, human steps never blocking, a rehearsal never evidence). Two do not apply: rule 3 is replaced by EAS-managed credentials (`eas credentials`, `--freeze-credentials`; `eas-build-and-submit` rule 8), and rule 11 by the build profile's image (`ios.image`), which the gate's `DTXcode` check compares with the Xcode pin.

`check-release-setup` prints `NOT APPLICABLE` on an EAS-only repo (it checks the local lane), so there `check-store-artifact` is the checker that reads `contracts/ios-release.json`.

## The Android counterpart

`android-release-play` owns the Play side; this table maps each iOS step so a release of both platforms reads the same way.

| iOS (this skill) | Android (android-release-play) |
|---|---|
| Team App Store Connect API key, `.p8` outside the repo | Play service account JSON with release permission, outside the repo; treated exactly like the `.p8` |
| Automatic signing, cloud-managed distribution certificate | Upload key (keystore outside the repo, passwords in `~/.gradle/gradle.properties`) and Play App Signing; EAS: managed keystore |
| `xcodebuild archive` + export (`.ipa`) | `./gradlew bundleRelease` (`.aab`); EAS: `buildType: "app-bundle"` |
| `IOS_BUILD_NUMBER` / `CFBundleVersion`, never reused | `versionCode`, strictly increasing, never reused |
| `testFlightInternalTestingOnly` preview builds | the internal testing track |
| store-artifact gate on the `.ipa` (Info.plist, entitlements, bundle strings) | the release gate on the `.aab` (manifest, permissions, `debuggable`, the AdMob application id) |
| `altool --upload-package`, then processing to `VALID` | Play Developer API edit and commit (or `eas submit -p android --path <gated .aab>`), then the track's review |
| App record: a human step in App Store Connect | The app in Play Console: a human step; the first upload of a new app is manual |
| Tags `v<version>+ios.<n>` | Tags `v<version>+android.<n>` |
| VoiceOver spot check | TalkBack spot check |
