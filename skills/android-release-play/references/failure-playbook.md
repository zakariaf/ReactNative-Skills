# Failure playbook

Symptom, cause and action for Android release failures. A **stop** goes to the developer as one
message (the step, the exact error line, the one action) and is never retried. Rows marked "from the
docs" come from Google's, Gradle's or Expo's documentation and were not reproduced on 2026-10-14.

## Contents

- Setup
- Build and signing
- The gate
- Upload
- After the upload

## Setup

| Symptom | Cause | Action |
|---|---|---|
| `check-play-release-setup` `[contract] there is no release contract` | the app ships to Play (eas.json submit android, or `release:android`) without the contract | copy `templates/contracts/android-release.json`, fill it in |
| `[lane] the contract lane is eas, but eas.json has no submit.production.android` | lane and `eas.json` disagree | add the submit profile (eas-build-and-submit) or switch the lane |
| `[lane] submit.production.android.track is ...` | two places name the testing track differently | make `eas.json` track equal `uploadTrack` |
| `[lane] submit.production.android.applicationId is ...` | `eas.json` pins no id, or another variant's | pin the contract `applicationId` there (eas-build-and-submit owns the file) |
| `[gated-upload] eas build --auto-submit ...` / `eas submit --latest ...` | a script or CI step uploads an Android build the gate never read | drop `--auto-submit` for Android (keep it with `--platform ios`), gate the downloaded artifact, `eas submit --path` it |
| `[inline-secrets] a signing password written into gradle.properties` (or `keystore.properties`, `.env*`) | a password sits in a file in the working tree | delete the line; the password lives in `~/.gradle/gradle.properties` only; if the file was ever committed or shared, treat key and password as leaked (signing-and-keys.md) |
| `[signing-plugin]` / `[version-source]` (local lane) | the app config lacks the plugin or `const ANDROID_VERSION_CODE` (an older app may still have a shared `const BUILD_NUMBER`) | wire them (examples/app-config-local-lane.md); move a shared number once to per-platform counters (release-pipeline.md, Version codes and tags) |
| `[lane] scripts/clock/system-clock.ts is missing` | the CLI's clock (dependency-management's canonical file) is not in the app | copy `templates/scripts/clock/` with its test |
| `ERROR ... declares workspaces and no expo dependency` | a multi-package repo checked from the root without `--app-dir` | pass `--app-dir apps/<app>` |
| `[secrets-ignored] ... credentials.json` | EAS local credentials could reach git or an agent's read | add `credentials.json` to `.gitignore` and `Read(**/credentials.json)` to the deny list; never open the file |
| `[secrets-outside] a keystore inside the repo` | a `.jks`/`.keystore` sits in the working tree | move it to `~/.android-keys/` without opening it; if it was ever committed, treat it as leaked |
| `preflight failed ... JAVA_HOME is not set` | no JDK in the environment | export `JAVA_HOME` (JDK 17) and `ANDROID_HOME` (android-emulator-build) |
| `no upload key at ~/.android-keys/...` | the key does not exist yet | ask for the go, then generate it (signing-and-keys.md) |
| `... has mode 644, expected 600` | the key or JSON is readable by others | `chmod 600` it; never open it |
| `app.config.ts needs exactly one const ANDROID_VERSION_CODE` | the local lane's number is missing or duplicated | one literal const feeding `versionCode` |
| `releases come from main (the contract releaseBranch), this is master` | the app releases from another branch | set the contract `releaseBranch` (default `main`) |
| `the working tree is not clean` right after a build | an older template left `package.json` with `expo run:*` scripts from the prebuild | the build now writes it back (`restored package.json: the prebuild had rewritten its ios/android scripts`); restore it once with `git checkout package.json` |

## Build and signing

| Symptom | Cause | Action |
|---|---|---|
| `keytool -printcert` shows `CN=Android Debug` | the upload properties are missing from `~/.gradle/gradle.properties` on this machine, or the plugin is not listed | list the plugin; ask the developer to check the properties file exists (never open it) |
| `withUploadSigning: app/build.gradle has no signingConfigs block` at prebuild | React Native changed its template | update `addUploadSigning` and its test against the new template, test first |
| `Keystore was tampered with, or password was incorrect` (from the docs) | a wrong password in `gradle.properties` | stop: the developer fixes the four properties |
| `Cannot recover key` or `Get Key failed` at `signReleaseBundle` (Gradle's wording from the docs; `jarsigner` says `key associated with upload not a private key`, reproduced) | the key password property differs from the store password: the PKCS12 keystore keeps one password, and keytool ignored a separate `-keypass` | stop: the developer writes the store password into `<PREFIX>_UPLOAD_KEY_PASSWORD` too (signing-and-keys.md); never regenerate a key Play already registered |
| `restored package.json: the prebuild had rewritten its ios/android scripts` | `expo prebuild` turns `expo start --android` into `expo run:android` | nothing: the build writes it back so the next preflight sees a clean tree; any other change stays for review (the rewrite reproduced on 2026-10-14 with a real `expo prebuild` of the reference app) |
| `Execution failed for task ':app:signReleaseBundle'` (from the docs) | the store file path is wrong | stop: the developer checks `<PREFIX>_UPLOAD_STORE_FILE` |
| EAS: `eas build` asks to generate a new keystore for an app already on Play | the project lost its credentials (new account or project) | stop: restore the original keystore into EAS; a new key needs an upload key reset |
| Gradle, NDK or JDK errors | the toolchain | android-emulator-build's failure reference |

## The gate

| Rule | Cause | Action |
|---|---|---|
| `signing` (debug or unsigned) | see Build and signing | never `--rehearsal` for a release |
| `signing` (registered key differs) | another machine's keystore, or regenerated EAS credentials | build with the registered key; if lost, the developer requests an upload key reset |
| `signing` (`uploadCertificateSha256 is null`) | first release | confirm the fingerprint, write it into the contract |
| `version-code` | a number already used, or not the build meant | build again (EAS increments; local takes the next number) |
| `version-name` | the version changed after the build | build again from the commit that holds the version |
| `package` / `constants-variant` | a testing variant was built, or `APP_VARIANT` changed mid-build | export both variables once for the whole build |
| `test-code` | test-only code shipped | rebuild with the variant exported for the whole run; check the literal comparison at the test-only `require()` (debug-menu-and-test-hooks) |
| `target-sdk` | an override lowered it | remove the `expo-build-properties` override |
| `page-alignment` | a 4 KB-aligned library, usually a third-party prebuilt | update that package; never ship it |
| `abi-64bit` | a 32-bit-only library | build all ABIs or drop it |
| `permissions` | a library added one | block it (`android.blockedPermissions`) or list it with its reason, then review Data safety |
| `permission-declaration` | Play needs a Console declaration | a person declares it; write `playDeclaration` |
| `ad-app-id` / `ship-placeholder` | sample or template values in production | admob-ads-and-consent; the developer supplies the real ids |
| `ERROR ... is not a file` / `cannot be read as a bundle` | wrong path (relative paths start at the repo root), an APK, or a download that failed | pass the `.aab` itself |
| `ERROR ... the bundle passed, but the stamp ... cannot be written` | `--stamp` points at a read-only or impossible path | pass a writable path inside the repo (relative to the repo root; when multi-package `apps/<app>/build/release-android/aab-gate.json`) and run the gate again |

## Upload

| Stop reason | Cause | Action |
|---|---|---|
| `api-not-enabled` | the API is off in the service account's project | stop: a person enables it |
| `auth` (401/403) | the service account lacks permission for this app (also an IAM "policy" answer), or its key was deleted | stop: Users and permissions, or a new key |
| `app-not-found` (404) | no app with this id in Play Console | stop: create the app; the first upload is a person's |
| `draft-app` | the app is still a draft | upload with `--draft-app` / `releaseStatus: "draft"`, the developer rolls out in the Console |
| `version-code-used` | an earlier upload used the number | build again with the next number |
| `policy-declarations` | App content incomplete (Google's message names a declaration) | stop: a person completes it |
| `changes-not-sent-for-review`: "Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true" | an earlier update was rejected, or changes are held, so Play will not send this edit for review by itself | stop: the developer decides. With their word, run the same command again with `--changes-not-sent-for-review` (eas.json: `changesNotSentForReview: true`), then the developer sends the changes for review in Play Console (Publishing overview) |
| `versionCode <n> is not above the upload tag ...` (before any call) | this bundle was uploaded already, or a newer one was | nothing to resend; a new change needs a new build |
| `no gate stamp` / `sha256 differs` | the gate did not pass on these bytes | run the gate on this bundle; changed bytes need a new build |
| network error, timeout | offline or Google is slow | ask before one retry; a half-done edit expires by itself |

## After the upload

| Symptom | Cause | Action |
|---|---|---|
| testers do not see the build | not on the testers list, or not opted in through the link with the same Google account | the developer adds them and shares the opt-in link |
| purchases show "item unavailable" | products not active, the app not installed from Play, or the account is not a license tester | in-app-purchases; the developer adds license testers |
| crash spike after a staged rollout step | a regression | `halt`, fix under a new versionCode (tracks-and-rollout.md) |
| ads never fill | a new AdMob app under review, or app-ads.txt | admob-ads-and-consent; nothing in the build changes |
