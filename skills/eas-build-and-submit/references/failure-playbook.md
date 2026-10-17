# Failure playbook: EAS Build and Submit

Symptom, cause, and what to do. Two kinds of row: **fix** (the agent fixes the repo and reruns) and
**stop** (a human or a credential must change: send one message with the step and the exact error line,
do not retry, do not switch credentials or signing method). The stop list agrees with
git-commits-and-reporting's release stops. Error texts marked "run" were reproduced on 2026-10-14; the
others are quoted from EAS CLI 24.10.0's source or Expo's docs.

## Contents

- Before the build (local)
- On the EAS worker
- Versions and numbers
- Submission
- After submission
- What every stop message holds

## Before the build (local)

| Symptom | Cause | Kind | Action |
|---|---|---|---|
| `eas.json is not valid.` then `"build.production.image" is not allowed` (run) | a key in the wrong place or misspelled | fix | move `image` into `ios`/`android`; `check-eas-config` (`eas-schema`) names every such key offline |
| `"build.production.node" failed custom validation because 26 is not a valid version` (run) | `node` must be a full version | fix | `"node": "26.4.0"` |
| `You are on eas-cli@x which does not satisfy the CLI version constraint defined in eas.json` | the global CLI is older than `cli.version` | fix | `npm install -g --min-release-age=7 --ignore-scripts eas-cli@<the floor or newer>` |
| `npm error code ESTRICTALLOWSCRIPTS` from `npx eas-cli` | npx installs EAS CLI into the app under `strict-allow-scripts` | fix | use the global install |
| `You have some uncommitted changes in your repository.` | `requireCommit: true` and a dirty tree | fix | commit (the preflight already refuses this) |
| `Missing build profile in eas.json: "<name>"` | a typo in `--profile`, or the profile was never added | fix | name an existing profile |
| `--platform is required when building in non-interactive mode` | CI or `--non-interactive` without `--platform` | fix | add `--platform ios`, `android` or `all` |
| the preflight says `version 1.2.0 is not above the last release v1.2.0` | the version was not raised after the last "ship" | fix | raise `version` in `app.config.ts` in its own commit |
| the preflight says `the android id of the build is com.example.tasks.dev` | the profile's env did not reach the config (a profile without `APP_VARIANT`) | fix | app-variants-and-environment's profile wiring; `check-variants` |

## On the EAS worker

| Symptom | Cause | Kind | Action |
|---|---|---|---|
| `npm error code EBADENGINE` during "Install dependencies" | the profile pins no `node`; the image's npm 10.9.8 fails `engines.npm` | fix | `"node"` in every profile (`build-node`) | <!-- stack-pin-ignore -->
| `npm error code EUSAGE` ... `can only install packages when your package.json and package-lock.json ... are in sync` | the lockfile was not committed with `package.json` | fix | `npm install` locally, commit both (dependency-management); never `EAS_NO_FROZEN_LOCKFILE` |
| `... are not set: production bundles and EAS builds name their variant` | the profile has no `APP_VARIANT` pair | fix | app-variants-and-environment |
| ENOENT on an icon or splash file | a variant's art is missing | fix | icons-app-icon-and-splash / app-variants-and-environment's badged icons |
| the build used a different Xcode than expected | `image` is `latest` or a stale alias | fix | expo-sdk-upgrade's `eas-image` rule (`auto` by default) |
| a build fails only on EAS, not locally | an EAS environment variable, the image, or the clean checkout differs | fix | reproduce with `eas build --local` (`EAS_LOCAL_BUILD_SKIP_CLEANUP=1`), read the step log on the build page |
| missing or invalid credentials (`Distribution Certificate is not validated`, `Provisioning profile ... doesn't support`, no keystore in non-interactive mode) | the stored credentials are absent, expired, revoked or for another id | **stop** | the developer fixes them with `eas credentials`; never regenerate with a build, never switch to local credentials |
| `You have reached the maximum number of ... certificates` | the Apple team's certificate limit | **stop** | the developer decides which certificate to revoke (others may depend on it) |
| the account's build quota or concurrency is exhausted, a billing error | the Expo plan | **stop** | the developer's plan and money |

## Versions and numbers

| Symptom | Cause | Kind | Action |
|---|---|---|---|
| `Remote versions are not configured and EAS CLI was not able to read the current version from your project` | remote versions without an initial value | **stop** | the developer runs `eas build:version:set` with the last store numbers |
| `The bundle version must be higher than the previously uploaded version` (ITMS-90189), or Play: `Version code N has already been used` | the remote counter is below what the store has | **stop** | the developer sets the counter (`eas build:version:set`); rebuild with the next number; never reuse one |
| `check-eas-build` `build-version`: `appBuildVersion 41 is not above the last uploaded ios build 41` | the same, caught before submitting | fix or stop | as above; do not submit this build |
| `check-eas-build` `build-fingerprint` differs | the worker saw other native inputs than the reviewed commit (an EAS variable the config reads, a different commit) | fix | find the difference with `eas fingerprint:compare --build-id <id>`; when the app config reads an EAS environment variable, rerun the preflight as `eas env:exec production 'node scripts/eas/release-preflight.ts --profile production --platform all'`; else rebuild from the reviewed commit |
| App Store Connect: the version is closed for new builds (ITMS-90062 or "train is closed") | that version was approved and released | fix | raise `version` |

## Submission

| Symptom | Cause | Kind | Action |
|---|---|---|---|
| an agreement error (`agreement`, `PLA Update available`, a `FORBIDDEN` naming an agreement) | Apple's agreements changed | **stop** | the account holder accepts it in App Store Connect |
| HTTP 401 `NOT_AUTHORIZED` or 403 `FORBIDDEN_ERROR` from App Store Connect | wrong, revoked or under-privileged API key | **stop** | the developer replaces the key with `eas credentials` |
| no app record for the bundle identifier, or `ascAppId` belongs to another app | the record is missing or the pin is wrong | **stop** | the developer creates the record; fix `ascAppId` |
| Play `403 The caller does not have permission` | the service account lacks release rights for this app | **stop** | Play Console > Users and permissions |
| Play `Package not found: <id>` | no Play app with that package name | **stop** | the developer creates the app |
| Play `Only releases with status draft may be created on draft app` | the Play app is still a draft | **stop** | submit with `releaseStatus: "draft"`, or the developer finishes the store listing |
| `eas submit` asks for an Apple ID password | `appleId` in the submit profile, or no stored API key | **stop** | set up the API key (credentials-and-signing.md); never type a password into an agent session |

## After submission

| Symptom | Cause | Kind | Action |
|---|---|---|---|
| the build stays "Processing" in TestFlight for hours | Apple's queue | wait | check again later; do not upload again (that spends a number) |
| processing ends `INVALID` with an email (ITMS-90683 purpose string, ITMS-91053 privacy manifest reason, ...) | the binary breaks an Apple rule | **stop** | forward the email; fix in the app (permissions-and-system-prompts, privacy-and-store-declarations); rebuild with a new number |
| testers do not see the build | no internal group, or the build was not added | fix | `--groups "<group>"`, or turn on automatic distribution for the group (a developer setting) |

## What every stop message holds

One message: the platform and step (`iOS, eas submit`), the exact error line, the one action the
developer takes, and the default that applies meanwhile ("until then the build stays unsubmitted and I
continue with the reminders screen"). Retrying a stop locks accounts, burns build numbers or hides the
real cause.
