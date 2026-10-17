# Signing, store uploads and EAS submit

Failures of the signed archive, export, store gate, upload, processing and the store consoles, on the EAS lane and the local lane. Rows marked "needs a human" are stops: send one message and never retry. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npx eas-cli --version && xcrun altool --version`.

<!-- Generated from assets/known-failures/release.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Signing
- Account
- Upload
- App Store Connect
- Export
- Store gate
- Secrets
- EAS
- Google Play gate
- Google Play upload
- After the Play upload

## Signing

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-keychain-locked` | errSecInternalComponent from codesign during the archive | The login keychain is locked (an SSH or other non-GUI session) | Stop: the developer unlocks the keychain or starts the run from the desktop; never retry; then rerun with --resume build (same build number, nothing uploaded) | documented, needs a human | iOS | `ios-release-testflight` |
| `release-codesign-access-dialog` | A macOS dialog: "codesign wants to access key ..." | The key's access list does not include codesign yet | Stop: the developer clicks Always Allow once | documented, needs a human | iOS | `ios-release-testflight` |
| `release-no-profiles` | No profiles for '<bundle id>' were found, or Automatic signing is disabled | -allowProvisioningUpdates or the three -authenticationKey* flags are missing, or DEVELOPMENT_TEAM is empty | Pass the API-key flags to xcodebuild; export APPLE_TEAM_ID before prebuild so app.config.ts writes ios.appleTeamId | documented | iOS | `ios-release-testflight` |
| `release-api-key-dev-cert` | The first archive with the API key cannot create the Apple Development certificate | Not verified whether an API key alone can create it on a new machine | Human step: the developer signs in once in Xcode > Settings > Accounts, then rerun | open, needs a human | iOS | `ios-release-testflight` |

## Account

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-agreement` | An error that mentions an agreement (altool, App Store Connect API) or "PLA Update available" (xcodebuild) | A new or expired Apple agreement | Stop: the developer accepts it in App Store Connect; then rerun with --resume build if the stop came before the upload, otherwise a plain rerun | documented, needs a human | iOS | `ios-release-testflight` |
| `release-no-app-record` | The upload cannot determine the Apple ID for the bundle ID, or no App Store Connect app record exists | The app record does not exist, and the public API cannot create apps | Stop: the developer creates it (My Apps > + > New App), then rerun | documented, needs a human | iOS | `ios-release-testflight` |
| `release-not-authorized` | NOT_AUTHORIZED (401) from altool or the App Store Connect REST API | A wrong key or issuer id, a revoked key, or clock skew (a token issued in the future) | Stop: check the key and issuer ids against the key file name without reading the key, and that the clock is on network time; a revoked key needs a new team key from the developer | verified, needs a human | iOS | `ios-release-testflight` |
| `release-forbidden` | FORBIDDEN_ERROR (403), or "not allowed to create distribution certificates" | The API key role is below Admin, or it is an individual key | Stop: the developer creates a team key with the Admin role | documented, needs a human | iOS | `ios-release-testflight` |
| `release-jwt-lifetime` | App Store Connect rejects a token that looks valid | A token that expires more than 20 minutes after its issue time is invalid; a stale clock also breaks the issue time | Sign tokens for 15 minutes and create a fresh one per request during long waits | documented | iOS | `ios-release-testflight` |

## Upload

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-processing-invalid` | Build processing state INVALID or FAILED | Apple rejected the binary during processing | Stop: ask the developer to forward Apple's email; fix the cause, then rebuild with a new build number | documented, needs a human | iOS | `ios-release-testflight` |
| `release-itms-90189` | ITMS-90189: Redundant Binary Upload | The build number was reused | Never reuse or roll back a number: bump and rebuild (check the earlier upload's processing first) | documented | iOS | `ios-release-testflight` |
| `release-itms-90062` | ITMS-90062: version must be higher than the previously approved version | The version was not raised after an approval | Raise the version in app.config.ts and rebuild | documented | iOS | `ios-release-testflight` |
| `release-itms-90683` | ITMS-90683: Missing purpose string in Info.plist (for example NSMicrophoneUsageDescription) | A linked library references a protected API (an audio library's record-permission API), so Apple requires the usage string even if the app never asks | Add a neutral, translated usage string through the library's config plugin option, or block the API in the plugin when the app never uses it; rebuild with a new build number | documented | iOS | `privacy-and-store-declarations` |
| `release-itms-privacy` | ITMS-91053 (missing API declaration), ITMS-91061 (missing privacy manifest for an SDK) or ITMS-91056 (invalid manifest) | The aggregated required-reason APIs are incomplete; Apple does not reliably read the manifests of static pods | Aggregate every pod manifest into ios.privacyManifests (the privacy audit fails on a gap), prebuild, rebuild with a new build number | documented | iOS | `privacy-and-store-declarations` |
| `release-upload-not-done` | altool --upload-package --wait (or eas submit) returned, but the build is not in TestFlight | They return once the build is PROCESSING, not VALID | Poll the processing state (REST) every 60 s for up to 60 minutes; done only at VALID | documented | iOS | `ios-release-testflight` |
| `release-processing-timeout` | Processing did not reach VALID within 60 minutes | Apple is slow, or the build is stuck | Check the TestFlight tab, then rerun with --resume processing (the upload is done; a plain rerun would upload a second build) | documented | iOS | `ios-release-testflight` |
| `release-processing-rest-error` | The release stops after the upload while waiting for processing, or reading the processing state failed | A REST error (401/403 or no network) while polling; the build is already at Apple | A 401 or 403 is a stop for the developer; otherwise restore the network. Then rerun with --resume processing | documented | iOS | `ios-release-testflight` |
| `release-cannot-resume` | release --resume stops: cannot resume (HEAD is not the build-number commit, or that build is already tagged) | A commit came after the build-number bump (usually the fix itself), or that build already finished | Rerun without --resume; it takes a new build number (gaps are harmless, Apple rejects only duplicates) | documented | iOS | `ios-release-testflight` |

## App Store Connect

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-no-internal-group` | The build is VALID but does not appear in TestFlight on a tester's phone | TestFlight shows a build only to testers in a group that has it; the app has no internal group with automatic distribution | Human step: the developer creates an internal testing group with automatic distribution and adds the testers; later builds then appear without another step | documented, needs a human | iOS | `ios-release-testflight` |
| `release-first-iap-with-version` | A first in-app purchase cannot be submitted on its own | The first in-app purchase must be submitted together with a new app version | Human step: the developer selects the purchase on the version page before Submit for Review; later purchases can be submitted alone | documented, needs a human | iOS | `in-app-purchases` |
| `release-store-locale-missing` | App Store Connect offers no store localization for one of the app's languages | Apple's store localization list does not cover every language an app can ship | Store texts use the closest supported store languages; the in-app languages are unaffected | documented | iOS | `i18n-strings-and-catalogs` |

## Export

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-manage-version-default` | The exported build has other version or build numbers than app.config.ts | manageAppVersionAndBuildNumber defaults to YES in ExportOptions | Set manageAppVersionAndBuildNumber to false in every export-options plist | documented | iOS | `ios-release-testflight` |
| `release-app-store-method` | xcodebuild warns that the export method app-store is deprecated | The ExportOptions method was renamed | Use method app-store-connect (destination export, signingStyle automatic) | documented | iOS | `ios-release-testflight` |

## Store gate

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-gate-failed` | The store-artifact gate fails on the exported .ipa or .aab | The artifact holds test-only code, a test artefact (StoreKit configuration, harness), a sample ad id, a placeholder, a stale build number or a debug entitlement | Fix the cause the gate names and rebuild with a new build number; never skip the gate or upload the artifact anyway | verified |  | `ios-release-testflight` |
| `release-test-ids-in-bundle` | grep finds Google's sample publisher id 3940256099942544 in every production bundle | react-native-google-mobile-ads ships its TestIds module in every bundle | Check the sample id on the source-mapped export with node_modules excluded; the binary gate checks the native app id and the test-only sentinel instead | verified |  | `admob-ads-and-consent` |
| `release-ship-placeholder` | A ship gate prints [ship-placeholder] lines: a com.example.* id, a Google sample AdMob app or unit id, example.com or an @example.com address, or an unfilled `__UPPER_SNAKE__` token | The real identifiers (bundle id, ad ids, privacy-policy URL, support address) were never supplied; every ship gate refuses each placeholder by name | Stop: the developer supplies the real values, then write them into app.config.ts and the contracts; never edit a gate or the placeholder list to pass, and never type a stand-in value | verified, needs a human |  | `ios-release-testflight` |
| `release-rehearsal-unsigned` | The store gate fails its signing rule (the app is not signed, codesign -d failed) on an archive built with CODE_SIGNING_ALLOWED=NO | Ship gates require a signed export; a keyless rehearsal archive has none | For a rehearsal only pass --rehearsal: the gate prints REHEARSAL: not a release gate and skips only the signing rule. A rehearsal is never release evidence | verified |  | `ios-release-testflight` |

## Secrets

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-secrets-printed` | A JWT, an Authorization header or private key text appears in a log, a report or a commit | Debug output or a copy of the key | Stop: the developer revokes the key, creates a new one and replaces the file; search git log -p -S for the key header and the reports folder | documented, needs a human |  | `ios-release-testflight` |

## EAS

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-eas-auto-submit` | A build reached TestFlight or Play without the store gate having read it (eas build --auto-submit, eas submit --latest) | The submit took whatever EAS built last instead of the artifact the gate passed | Download the artifact, run the gate on it, then eas submit --path <that file>; --auto-submit only for iOS when the gate runs on the EAS record | documented |  | `eas-build-and-submit` |
| `release-eas-new-keystore` | eas build offers to generate a new keystore (or certificate) for an app that is already in the store | The EAS project lost its credentials (another account or project) | Stop: restore the original credentials into EAS (eas credentials); build with --freeze-credentials so a non-interactive build never replaces them | documented, needs a human |  | `eas-build-and-submit` |

## Google Play gate

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-play-target-sdk-low` | The AAB gate or the release setup check fails target-sdk: targetSdkVersion (or compileSdkVersion) is <n>, below <Play floor> | An expo-build-properties override (android.targetSdkVersion or compileSdkVersion) or a config plugin lowered the level the Expo SDK sets | Remove the override and prebuild with --clean; keep compileSdk and targetSdk from the Expo SDK (36). Play refuses new apps and updates below its floor, so never ship the lower level | documented | Android | `android-release-play` |

## Google Play upload

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-play-api-not-enabled` | The Play upload stops: api-not-enabled (HTTP 403); Google says SERVICE_DISABLED or "Google Play Android Developer API has not been used in project <n> before or it is disabled" | The Google Play Android Developer API is off in the Google Cloud project that owns the service account | Stop: the developer enables the API in that Cloud project (it takes a few minutes to apply); never retry before they confirm, then rerun the same upload command | documented, needs a human | Android | `android-release-play` |
| `release-play-auth` | The Play upload (or eas submit) stops: auth (HTTP 401 or 403): "The caller does not have permission", "Permission ... denied by IAM policy" or "Request had invalid authentication credentials" | The service account is not invited to this app in Play Console (Users and permissions), lacks the release permission for the track, or its JSON key was deleted or revoked | Stop: the developer grants the service account access to this app with release rights for the track, or makes a new JSON key; never retry, never open or print the key file | documented, needs a human | Android | `android-release-play` |
| `release-play-app-not-found` | The Play upload stops: app-not-found (HTTP 404), or eas submit says "Package not found: <package>" | No app with this package name exists in Play Console yet, or its first build was never uploaded by hand: the Play API can neither create an app nor make its first upload | Stop: the developer creates the app in Play Console and uploads the first .aab to internal testing by hand (the release skill names the bundle); automated uploads work from the second build on | documented, needs a human | Android | `android-release-play` |
| `release-play-draft-app` | Only releases with status draft may be created on draft app (the upload stops: draft-app) | The Play app is still a draft (store listing or App content never completed), so Play accepts only draft releases | Stop and ask: with the developer's word upload as a draft (--draft-app, or releaseStatus "draft" in eas.json submit) and the developer rolls it out in Play Console; or the developer finishes the store setup first | documented, needs a human | Android | `android-release-play` |
| `release-play-policy-declarations` | The Play upload stops: policy-declarations; Google names a declaration ("You must complete the advertising ID declaration", Data safety, content rating, target audience, privacy policy) | App content in Play Console is incomplete; Play answers some of these with 403, which is not a permission problem | Stop: the developer completes the declaration Google names in App content (privacy-and-store-declarations keeps the answers); rerun the same upload once it is done | documented, needs a human | Android | `android-release-play` |
| `release-play-changes-not-sent-for-review` | Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true | An earlier update was rejected, or the app's changes are held for review by hand, so Play will not send this edit for review by itself | Stop: the developer decides. With their word, run the same command again with --changes-not-sent-for-review (eas.json submit: changesNotSentForReview true), then the developer sends the changes for review in Play Console (Publishing overview) | documented, needs a human | Android | `android-release-play` |
| `release-play-network` | The Play upload stops on a network error or a timeout | The machine is offline, or Google answered too slowly | Ask before one retry; a half-done Play edit expires by itself and the gated bundle is unchanged, so the retry uploads the same file | documented, needs a human | Android | `android-release-play` |

## After the Play upload

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-play-testers-no-build` | Internal or closed testers do not see the build on Google Play | They are not on the track's testers list, have not opted in through the track's link, or are signed in to Play with another Google account than the one on the list | Human step: the developer adds the tester's Google account to the list and shares the opt-in link; the tester opens it signed in with that same account. Nothing in the build changes | documented, needs a human | Android | `android-release-play` |
