# Release failure playbook

Match the text of the failing step's log in the first column. **Stop** rows end the run with one message to the developer (the step, the exact error line, the one action needed) and are never retried: retries can lock the account or burn build numbers. The other rows are the agent's to fix. `scripts/release/release-failures.ts` encodes the same table, so `release:ios` prints the right message by itself; the EAS lane prints the same Apple errors inside `eas build` / `eas submit` logs.

## Contents

- The table
- After a stop
- Open questions to record on the first real release

## The table

| Symptom (match the text) | Cause | Action |
|---|---|---|
| `You have not agreed to the Xcode license agreements` | the pinned Xcode's licence was never accepted (or a new Xcode was installed) | **Stop** (human step: Xcode licence). The developer runs `<DEVELOPER_DIR>/usr/bin/xcodebuild -license accept`, prefixed with sudo, in Terminal; the agent never runs sudo. Then `--resume build` |
| `errSecInternalComponent` from `codesign` during the archive | login keychain locked (SSH or non-GUI session) | **Stop** (unlock the keychain). The developer runs `security unlock-keychain ~/Library/Keychains/login.keychain-db` in Terminal, or starts the run from the logged-in desktop. Then `--resume build` |
| A macOS dialog "codesign wants to access key ..." | the key's access list does not allow codesign yet | **Stop.** The developer clicks Always Allow once |
| Text containing `agreement` (altool or App Store Connect), `PLA Update available` (xcodebuild), or `FORBIDDEN...` whose detail mentions an agreement | a new or expired Apple agreement | **Stop** (accept the agreement) at developer.apple.com and/or App Store Connect > Business; then `--resume build` if the stop came before the upload, otherwise a plain rerun |
| `No App Store Connect app record for ...`, or the upload cannot determine the Apple id | the app record for this variant's bundle id is missing | **Stop** (app record). The developer creates it (Apps > + > New App) with an internal tester group, then rerun. No API endpoint creates apps |
| `[ship-placeholder]` lines from the gate or `check-release-setup` | a template value is still in the config: `com.example.*`, a template or sample AdMob id, an `example.com` link, an unfilled `__TOKEN__` | **Stop** (real values): ask once, in one message, for the values the lines name; never type a stand-in. Any other FAIL line next to them is a real problem to fix |
| `NOT_AUTHORIZED` (401) from altool or REST | wrong key or issuer id, revoked key, or clock skew (`iat` in the future) | **Stop** (API key). Check the env ids against the key file name (without reading it) and that the Mac clock is on network time; a revoked key needs a new team key |
| `FORBIDDEN_ERROR` (403), "not allowed to create distribution certificates", cloud signing permission errors | key role below Admin, or an individual key | **Stop** (API key). The developer creates a team key with the Admin role |
| Build status `INVALID` or `FAILED` | Apple rejected the binary during processing | **Stop** (Apple's email). The developer forwards Apple's email (the agent cannot read email); fix, then rebuild with a new build number |
| `ITMS-90683: Missing purpose string in Info.plist` | a linked SDK references a protected API (camera, microphone, photos, ...) without its usage description, even when the app never asks | add the key through the library's config plugin option or `ios.infoPlist` (one of the two), translated in every language through the app config locales; list it in the contract's `usageStrings`; rebuild with a **new** build number |
| `ITMS-91053` (missing API declaration), `ITMS-91061` (missing privacy manifest for a listed SDK), `ITMS-91056` (invalid manifest) | the aggregated required-reason APIs are incomplete | run the privacy-manifest audit, add the missing category and reason to `ios.privacyManifests` (`privacy-and-store-declarations`), prebuild, rebuild with a new build number |
| `ITMS-90189: Redundant Binary Upload` | build number reused | never reuse: rerun without `--resume`. If the earlier upload really succeeded, check its processing state first |
| `ITMS-90062` (version must be higher than the approved one) | the version was not raised after an approval | raise the version in `app.config.ts`, commit, rerun |
| `No profiles for '<bundle id>' were found`, `Automatic signing is disabled`, `requires a development team` | `-allowProvisioningUpdates` or the key flags missing, or no `DEVELOPMENT_TEAM` | check the auth arguments and that `ios.appleTeamId` was set from `APPLE_TEAM_ID` **before** the prebuild |
| The first API-key archive cannot create the Apple Development certificate | the team has no development certificate usable on this Mac, and the key alone did not create one | **Stop** (fallback human step): the developer signs in once in Xcode > Settings > Accounts; then `--resume build` |
| Black screen at launch after building with a newer Xcode than the SDK expects | a UIScene life-cycle change | build with the pinned Xcode, or follow `expo-sdk-upgrade` for the Xcode move |
| `release:ios` stops after the preflight: "... gates test-only code, but no test-only sentinel is known" (or `check-store-artifact` fails `[test-code]` with the same text) | the app has a test-only gate but exports no `*SENTINEL*` constant and lists none in `rn-skills.config.json` | export one from the test-only entry (`debug-menu-and-test-hooks`) or list it in `testOnlySentinels`, commit, rerun the same command (no build number was used) |
| The gate finds the test-only sentinel in production, `extra.appVariant` of another variant, or `EXConstants` disagreeing with Info.plist | Metro cache not keyed on the public variables, a test-only gate that is not literal, or variables lost between steps | check the Metro cache key and the literal gate (`app-variants-and-environment`, `debug-menu-and-test-hooks`) and that the variables stay exported for the whole run; rebuild with a new build number |
| `react-native-skia: Skia prebuilt binaries not found` during `pod install` | the package's postinstall never ran (install scripts not allowed, or `node_modules` copied without them) | run `npx install-skia` (or allow the package's install script and reinstall); it fills `libs/ios` and `libs/macos` |
| `pod install` fails downloading a trunk pod or spec | no network at build time, or a CDN problem | retry once after 5 minutes; pods are pinned exactly, never loosen versions |
| `EXPO_PUBLIC_APP_VARIANT=... must equal APP_VARIANT=...` | only one of the two was exported | export both (`variantEnv`) |
| Disk full | old DerivedData and archives | `rm -rf build/ios-release`; never delete archives the developer kept on purpose |
| `unfinished work is still marked (...)` (preflight) or the gate's `[forbidden-string]` / `[unfinished-marker]` | a contract marker file exists, or a stand-in screen's string is in the bundle | finish the work, delete the marker, commit, then a plain rerun (a new build number if the gate stopped it) |
| `store-artifact gate failed` | the export has test code, a test artefact, the wrong ad id, a stale build number, a placeholder or `get-task-allow` | fix the cause the message names, commit the fix, rerun without `--resume` (a new build number); never skip the gate |
| `processing did not reach VALID within 60 minutes` | Apple is slow, or the build is stuck | look in App Store Connect (TestFlight tab); then rerun with `--resume processing` (nothing is uploaded again) |
| `... while waiting for processing` or `reading the processing state failed` | a REST error (401/403, network) after the upload succeeded | a 401 or 403 is a **Stop** (API key); a network error needs the network back. Then rerun with `--resume processing`: the build is already at Apple, so a plain rerun would upload a second one |
| `setting What to Test: App Store Connect answered ...` after `VALID` | a REST error while writing the tester notes | fix the cause (a 401/403 is a stop), then rerun with `--resume processing` |
| `cannot resume: HEAD is "..."` or `cannot resume: build <n> is already tagged` | a commit came after the bump, or that build already finished | rerun without `--resume`; a new build number is harmless (Apple rejects only duplicates) |
| `eas submit` reports missing or invalid credentials | EAS credentials are not set up for this app | **Stop**: the developer fixes them (`eas credentials`); the agent never uploads key files itself |

## After a stop

Post one message to the developer with the step, the exact error line, and the one action needed (`stopMessage()` writes it; `git-commits-and-reporting` has the report check). Once the developer confirms, rerun as the message's `Resume:` line says: a stop before the bump is a plain rerun, a stop after the bump and before the upload is `--resume build` with the same build number, and an uploaded build is `--resume processing`. A number is never reused once an upload was attempted.

## Open questions to record on the first real release

Unverified because no real key was used: whether the API key alone can create the Apple Development certificate on a fresh Mac; the altool upload JSON field that holds the delivery id; whether `--upload-package --wait` returns at `PROCESSING` (man page) or at processing completion (`altool --help`); whether `--build-status --wait` waits until `VALID`; the exact `--beta-app-store-text` folder layout for a build's `whatsNew` (REST is used instead); whether `--validate-app` or `--upload-package` need `--provider-public-id` with a team key (if altool asks, `xcrun altool --list-providers` with the same `--api-key`/`--api-issuer` prints it); and the exit code of `security show-keychain-info` on a locked keychain. Write each answer into the matching reference of this skill and into `release-failures.ts` when it changes a message.
