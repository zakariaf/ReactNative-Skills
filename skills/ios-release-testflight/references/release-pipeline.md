# The release pipeline, step by step

`npm run release:ios -- --variant preview|production` (the local lane) runs these steps in order. Every step logs to `<app>/build/ios-release/logs/<step>.log`; any non-zero exit stops the run and the failure playbook decides what happens next. Read this before a release, and when a step fails and you need to run it by hand. The EAS lane replaces steps 2-6 and 8-9 with `eas build` and `eas submit` and keeps step 7, the gate (`eas-lane-and-android.md`).

## Contents

- Two kinds of TestFlight build
- Step 0: environment
- Step 1: preflight
- Step 2: build number
- Step 3: prebuild and post-prebuild scripts
- Step 4: archive
- Step 5: export (and the ExportOptions files)
- Step 6: unpack for the gate
- Step 7: the store-artifact gate
- Step 8: validate
- Step 9: upload
- Step 10: wait for processing
- Step 11: What to Test
- Step 12: tag and report
- Resuming a stopped run
- Rehearsal without the key (no upload)
- Versions, build numbers and tags
- After "ship"

## Two kinds of TestFlight build

| Variant | Bundle id | Ads (with the ads SDK) | Export options | Can reach |
|---|---|---|---|---|
| `preview` | `<appId>.preview` (its own app record) | `test` or `off` | `export-options-preview.plist` (`testFlightInternalTestingOnly: true`) | internal TestFlight testers only: "this build cannot be distributed via external TestFlight or the App Store" (`xcodebuild -help`) |
| `production` | `<appId>` | `live` or `off` | `export-options-production.plist` | TestFlight (internal and external) and the App Store |

`development` builds never reach TestFlight: they are dev clients (`eas-build-and-submit`, `ios-simulator-build`). Both TestFlight variants bump the one `IOS_BUILD_NUMBER`, so the numbers stay unique across them. Preview builds carry the test-only code (the debug menu); production builds never do.

## Step 0: environment

```sh
export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer   # the name the toolchain human step asks for; selectXcode() finds 26.6 under any name
export EXPO_NO_TELEMETRY=1 CI=1
export APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production          # variantEnv(variant); ADS_MODE only when not the default
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"   # a path only; never read it
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY_PATH" \
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
ALTOOL_AUTH=(--api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID")       # altool finds AuthKey_<id>.p8 itself
```

`release-ios.ts` builds this environment once (`selectXcode()` plus `variantEnv()`) and passes the same object to every step, so the variant reaches the prebuild, the Constants build phase and Metro identically (the three moments `app-variants-and-environment` describes).

## Step 1: preflight

Stop on the first failure, before anything is built, committed or uploaded:

- The working tree is clean and on the contract's `releaseBranch` (default `main`); none of the contract's `unfinishedMarkers` exists.
- `ASC_KEY_ID`, `ASC_ISSUER_ID` and `APPLE_TEAM_ID` are set; the key file exists with mode `-rw-------` (checked with `stat`, never read).
- The login keychain is unlocked: `security show-keychain-info ~/Library/Keychains/login.keychain-db` exits 0.
- `npx expo config --json --type public` with this run's environment resolves name, version and `ios.bundleIdentifier`, and the bundle id is the variant's own (`<appId>` or `<appId>.preview`, from `contracts/ios-release.json`).
- The What to Test text of this run is built and length-checked now (`releaseWhatToTest()` with the planned build number: the next one, or the stopped run's with `--resume`). Over TestFlight's 4000 characters it stops with "shorten --notes or --known-issue" and nothing was built, committed or uploaded.
- Each contract `preflight` script runs (default `verify`: the full gate of `quality-gates`).
- Production only: the version is higher than the last release tag `v<X.Y.Z>` (upload tags contain `+` and do not count).
- The app record exists: `findAppByBundleId` (`node scripts/asc/print-app-record.ts --variant <v>` by hand) answers `{"id","name"}`; exit 2 means no record, a human step. The numeric `id` is the Apple id the upload needs.
- Right after the preflight, before the bump: when the app has a test-only gate (`src/**/test-only.ts`, `debug-menu-and-test-hooks`), at least one test-only sentinel is known (an exported `*SENTINEL*` constant under `<appDir>/src`, or `rn-skills.config.json` `testOnlySentinels`). Without one the gate in step 7 could not tell whether the debug menu shipped, so `release:ios` stops here with the message `check-store-artifact` prints for the same gap, and no build number is spent.

Not in the script, because the workflow does it before the release: for a production build, green E2E flows and reviewed screenshots of this commit when the repo has them (`e2e-maestro`).

## Step 2: build number

```sh
node scripts/release/bump-build-number.ts                    # +1 on `const IOS_BUILD_NUMBER = <n>;`
git commit -am "chore(release): build 15" -m "App Store Connect build for the production variant (TestFlight)."
```

`release-ios.ts` does this itself (`bumpAndCommit`). The number is committed before the archive so the archive and the history agree. With `--resume build|processing` it bumps nothing and reuses the committed number (see "Resuming a stopped run").

## Step 3: prebuild and post-prebuild scripts

```sh
npx expo prebuild --platform ios --clean     # ios/ is generated (Continuous Native Generation)
npm run -s audit:privacy                      # contract postPrebuild: scripts that read ios/Pods
npm run -s audit:network
```

The contract's `postPrebuild` list names them (`privacy-and-store-declarations` owns the audits). A missing script is a `check-release-setup` failure (`release-prereqs`), never a reason to drop the step.

## Step 4: archive

```sh
xcodebuild -workspace ios/Tasks.xcworkspace -scheme Tasks -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/ios-release/Tasks.xcarchive \
  -derivedDataPath build/ios-release/dd "${AUTH[@]}" archive
```

`generic/platform=iOS` builds for any device and names none, so no simulator or phone is touched. Check: `plutil -p build/ios-release/Tasks.xcarchive/Info.plist` shows `CFBundleVersion` equal to the new build number.

## Step 5: export (and the ExportOptions files)

```sh
xcodebuild -exportArchive -archivePath build/ios-release/Tasks.xcarchive \
  -exportOptionsPlist scripts/release/export-options-production.plist \
  -exportPath build/ios-release/export "${AUTH[@]}"
IPA=$(ls build/ios-release/export/*.ipa)
```

The two files (`templates/scripts/release/`) differ only in `testFlightInternalTestingOnly`. Each key (`xcodebuild -help`, Xcode 26.6; both pass `plutil -lint`):

| Key | Value | Why |
|---|---|---|
| `method` | `app-store-connect` | `app-store` is deprecated |
| `destination` | `export` | keeps altool in charge of uploading (and the gate in between) |
| `signingStyle` | `automatic` | API-key signing with a cloud-managed certificate |
| `manageAppVersionAndBuildNumber` | `false` | defaults to YES, which lets Xcode rewrite the numbers |
| `uploadSymbols` | `true` | dSYMs go to Apple, so crash reports users choose to share symbolicate in App Store Connect (an OS feature; a crash SDK uploads its own: `crash-reporting-and-observability`) |
| `stripSwiftSymbols` | `true` | a smaller binary |
| `testFlightInternalTestingOnly` | `true` (preview) / `false` (production) | preview builds can never reach external testers or the App Store |
| `teamID` | omitted | "defaults to the team used to build the archive" (`DEVELOPMENT_TEAM`) |

## Step 6: unpack for the gate

```sh
rm -rf build/ios-release/ipa-check && unzip -q "$IPA" -d build/ios-release/ipa-check
APPDIR=$(ls -d build/ios-release/ipa-check/Payload/*.app)
```

## Step 7: the store-artifact gate

`release-ios.ts` runs `store-gate.ts` on the unpacked app; `check-store-artifact.mjs` (this skill) checks the same `.ipa` independently and is what the definition of done cites. Every rule and its reason is in `contract-and-checks.md`. By hand:

```sh
plutil -extract CFBundleVersion raw "$APPDIR/Info.plist"                # == the new build number
plutil -extract CFBundleShortVersionString raw "$APPDIR/Info.plist"     # == the version
plutil -extract DTXcode raw "$APPDIR/Info.plist"                        # 2660 for Xcode 26.6
plutil -extract CFBundleIdentifier raw "$APPDIR/Info.plist"             # <appId> or <appId>.preview
plutil -extract ITSAppUsesNonExemptEncryption raw "$APPDIR/Info.plist"  # production: set (false for HTTPS-only)
plutil -extract GADApplicationIdentifier raw "$APPDIR/Info.plist"       # with ads: the real id (live) or Google's sample (test/off)
plutil -p "$APPDIR/ar.lproj/InfoPlist.strings"                          # every usage description, per language
plutil -extract extra.appVariant raw "$APPDIR/EXConstants.bundle/app.config"   # == APP_VARIANT (plutil reads this JSON file)
grep -a -c 'TASKS_TEST_BUILD_ONLY' "$APPDIR/main.jsbundle"              # production: 0; preview: 1 or more
find "$APPDIR" \( -name '*.storekit' -o -name '*.xctest' \) | wc -l     # production: 0
test -f "$APPDIR/PrivacyInfo.xcprivacy"
codesign -d --entitlements - --xml "$APPDIR" | grep -c get-task-allow   # 0, or followed by <false/>
plutil -extract NSAppTransportSecurity.NSAllowsArbitraryLoads raw "$APPDIR/Info.plist"   # must fail (absent) or print false
plutil -extract NSBonjourServices raw "$APPDIR/Info.plist"              # must fail: a Release archive strips _expo._tcp
```

`grep -c` and `find | wc -l` print a count: compare the number (`grep -c` exits 1 when the count is 0; that exit code is not a failure). Hermes bytecode keeps string literals as plain bytes, so the sentinel and the forbidden strings are found in `main.jsbundle`.

## Step 8: validate

```sh
xcrun altool --validate-app "$IPA" -t ios "${ALTOOL_AUTH[@]}" --output-format json
```

## Step 9: upload

```sh
xcrun altool --upload-package "$IPA" -t ios --apple-id "$APPLE_APP_ID" --bundle-id "$BUNDLE_ID" \
  --bundle-version "$BUILD_NUMBER" --bundle-short-version-string "$VERSION" \
  "${ALTOOL_AUTH[@]}" --wait --output-format json > build/ios-release/logs/upload.json
```

The Xcode 26.6 man page says `--wait` returns once the build is `PROCESSING`; `altool --help` says "processing completion". The pipeline polls for `VALID` either way. The JSON holds a delivery id whose field name is not documented, so `findDeliveryId()` searches for it.

## Step 10: wait for processing

`release-ios.ts` waits 2 minutes (Apple never lists a fresh upload sooner), then reads one build's `attributes.processingState` every 60 s for up to 60 minutes (`processing-wait.ts`, tested on a fake clock):

```text
GET /v1/builds?filter[app]=<APPLE_APP_ID>&filter[version]=<BUILD_NUMBER>&filter[preReleaseVersion.version]=<VERSION>&fields[builds]=processingState&limit=1
```

The key is read into memory once for the wait, and one token serves every poll until about a minute before it expires (`reusedToken`); the token is never logged. On `INVALID` or `FAILED`: stop and ask the developer for Apple's email (the agent cannot read email). If 60 minutes pass without `VALID`, the run ends; after a look at the TestFlight tab, rerun with `--resume processing` (nothing is uploaded again).

## Step 11: What to Test

`setWhatsNew()` sends the text the preflight built: `GET /v1/builds/{id}/betaBuildLocalizations`, then `PATCH /v1/betaBuildLocalizations/{id}` with `{"data":{"type":"betaBuildLocalizations","id":"...","attributes":{"whatsNew":"..."}}}`, or `POST /v1/betaBuildLocalizations` with `locale: "en-US"` and the `build` relationship when none exists. `whatsNew` holds up to 4000 characters. A failure here keeps the `Resume: ... --resume processing` line.

The text (English, for testers only, not an in-app string; the extra lines come from the contract's `whatToTest`):

```text
Tasks 1.4.0 (14) · production build
What changed
- <feat/fix commit subjects since the previous upload tag, at most 20>
Please check
- <focus items passed with --notes>
- <whatToTest.whenChanged lines whose paths changed, every one on a first build>
- <whatToTest.always lines, for example: switch to an RTL language once>
Known issues
- <from --known-issue, or "none">
```

## Step 12: tag and report

```sh
git tag -a v1.4.0+ios.14 -m "App Store build 14 (TestFlight, production)"   # after VALID
```

Report to the developer in one message (`examples/release-messages.md`): app, version (build), variant, "available in TestFlight", the What to Test text, the one question for a production build ("ship" or "don't ship"), and "Human steps (not blocking)". Push tags only when the developer has said so in this session, by name (`git push origin v1.4.0+ios.14`), never `--tags`.

## Resuming a stopped run

Every failure message ends with a `Resume:` line. The rule behind it: a build number is spent once an upload was attempted, and a code fix is a new commit, which always gets a new number.

| Where it stopped | Rerun with | What happens |
|---|---|---|
| Preflight (a preflight script, `expo-config`, the bundle id, key, keychain, app record) | the same command | nothing was bumped yet |
| After the bump, before the upload (prebuild, post-prebuild scripts, archive, export, validate), and the developer fixed it (keychain, agreement, licence) | the same command plus `--resume build` | reuses the committed build number and starts again at the prebuild |
| The cause was in the code (a gate failure, an audit finding) | the same command, after committing the fix | a new build number; `--resume` refuses because HEAD is no longer the bump commit |
| `upload` failed and the TestFlight tab does not list the build | the same command | a new build number |
| The build is uploaded (processing timeout, a What to Test or tag failure) | the same command plus `--resume processing` | waits for `VALID`, sets What to Test, tags; builds and uploads nothing |

`--resume` checks before it reuses anything: HEAD must still be `chore(release): build <n>` for the number in `app.config.ts`, and no `v*+ios.<n>` tag may exist. Otherwise it stops with "cannot resume" and a plain run is right (gaps in build numbers are harmless; Apple rejects only duplicates).

## Rehearsal without the key (no upload)

Until the team key exists, or to prove a production build without touching Apple, rehearse it end to end on an unsigned archive. It proves the prebuild, the post-prebuild scripts, the archive and every artifact rule except the signature; it uploads nothing and is never release evidence. With the ads SDK, rehearse with ads off when the real ad ids are not there yet:

```sh
export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer   # the pinned Xcode (Xcode-<version>.app)
export APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production ADS_MODE=off EXPO_NO_TELEMETRY=1 CI=1
npx expo prebuild --platform ios --clean
xcodebuild -workspace ios/Tasks.xcworkspace -scheme Tasks -configuration Release \
  -destination generic/platform=iOS -archivePath build/ios-release/Tasks.xcarchive \
  -derivedDataPath build/ios-release/dd CODE_SIGNING_ALLOWED=NO archive > build/ios-release/logs/rehearsal-archive.log 2>&1
APP=build/ios-release/Tasks.xcarchive/Products/Applications/Tasks.app
node ${CLAUDE_SKILL_DIR}/scripts/check-store-artifact.mjs . --app "$APP" --variant production --ads off --version 1.4.0 --build 14 --rehearsal
```

Such an app has no signature at all (`codesign -d` answers "code object is not signed at all"), so the gate takes `--rehearsal`: it prints `REHEARSAL: not a release gate` first, reports only the signing rule as a `SKIP` line (a signed app that grants `get-task-allow` still fails), and keeps every other rule strict. Without `--rehearsal` the same app fails "the app is not signed". A production/off archive carries Google's sample app id and no ad units, yet the live build it stands in for carries the app's own ids, so the rehearsal also reads the ad ids file (contract `adIdsFile`, default `src/config/admob-ids.ts`) and reports each placeholder there: the rehearsal names every real value still missing. An app whose store build really ships with ads off sets the contract's `productionAdsMode` to `"off"`: there is no live build to stand in for, so the file is not read and the rehearsal is judged exactly like the signed release (which then also defaults to ads off). The result stays FAIL until the developer supplies them; no mode turns a placeholder into a pass. A hand-over before that is a slice report (`git-commits-and-reporting`): the rehearsal under "Not tested or not verified", the missing values as human steps.

Verified on 2026-10-14 on the reference Tasks app (Expo SDK 57, Xcode 26.6, production variant, ads off): the clean prebuild and the `CODE_SIGNING_ALLOWED=NO` archive took about 5 minutes; `check-store-artifact --rehearsal` printed `REHEARSAL: not a release gate`, the one `SKIP` line and `RESULT: PASS` (identity, `DTXcode 2660`, bundle id, usage strings in `en` and `ar`, privacy manifest, encryption flag, and no `_expo._tcp` key: the Release archive strips the dev-client keys); with a planted forbidden string and a wrong `--build` it failed on exactly those two rules; `store-gate.ts` on the same app reported only the missing signature.

## Versions, build numbers and tags

| Field | Where | Format | Who changes it |
|---|---|---|---|
| version -> `CFBundleShortVersionString` | `app.config.ts`, one literal | `MAJOR.MINOR.PATCH` | the agent per release: PATCH fixes, MINOR features, MAJOR the developer's call |
| build number -> `CFBundleVersion` | local lane: `const IOS_BUILD_NUMBER = <n>;` in `app.config.ts`; EAS: remote | integer, 1 or more | local: only `release:ios`, +1 before every archive, committed as `chore(release): build <n>`; EAS: `autoIncrement` |

- A build number is never reused or rolled back (ITMS-90189), across versions and variants.
- A failed or abandoned upload still consumes its number.
- A version App Review approved is frozen; the next store submission needs a higher version (ITMS-90062).
- Simulator builds never bump the number.
- Upload tag `v<version>+ios.<n>` after each processed upload; release tag `v<version>` when the developer says "ship"; both annotated and `git check-ref-format`-safe. When multi-package: `<app folder>/v...` and the commit scope is the folder (`chore(mobile): build 14`).

## After "ship"

1. `git tag -a v1.4.0 -m "Release 1.4.0"` (`releaseTag()`), pushed only with the developer's word.
2. The developer completes the per-release human steps (store listing, submit for review) or tells the agent "submit"; the agent never submits without that message.
3. Submitting through the API (only after "submit"; not run with a real key): the App Store version must exist with this build selected and its listing complete. Then `POST /v1/reviewSubmissions` with `{"data":{"type":"reviewSubmissions","attributes":{"platform":"IOS"},"relationships":{"app":{"data":{"type":"apps","id":"<APPLE_APP_ID>"}}}}}`, `POST /v1/reviewSubmissionItems` relating that submission to the `appStoreVersions` id, and `PATCH /v1/reviewSubmissions/{id}` with `"attributes":{"submitted":true}`. On any error answer, stop and ask the developer to click Submit for Review in App Store Connect instead.
