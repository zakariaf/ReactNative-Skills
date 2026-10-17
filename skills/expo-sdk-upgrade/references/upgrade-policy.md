# Upgrade policy: when an Expo SDK or toolchain move is allowed

Why the app stays on its SDK, the exact trigger for the next one, the store deadlines that can force
a toolchain move, what always moves together, and what never moves with it. Read this first in any
upgrade task, and at session starts while a new SDK is in its release window.

## Contents

- The current line and the next one
- The trigger (all three conditions)
- Store deadlines
- What moves together, in one commit
- What never moves with an SDK
- Toolchain policy in short
- Node is not part of an SDK move
- Human steps and stop-and-ask points
- Checking the facts yourself

## The current line and the next one

Verified on 2026-10-04 (re-verify with the commands at the end):

| | SDK 57 (current) | SDK 58 (next) |
|---|---|---|
| npm | `latest` = `sdk-57` = 57.0.26 (published 2026-09-29) | `next` = 58.0.3 (published 2026-10-03); not `latest`, so no move is due |
| React Native / React | 0.86.3 / 19.2.3 | 0.88.0-rc.3 / 19.3.0 (in expo 58.0.3) |
| Jest (what jest-expo peers on) | 29.7 | 30 (jest-expo 58.0.7 peers on `^30.0.0`; 58.0.6 and earlier had no jest peer, Jest 29 by Expo's versions API) |
| Xcode | 26.x (EAS `sdk-57` image: Xcode 26.6); Xcode 27 only with scene support | 26.4 or newer (the v58 docs versions table, read 2026-10-04); EAS `sdk-58` image: Xcode 27.0 |
| Android compileSdk / targetSdk / minSdk | 36 / 36 / 24 (AGP 8.12.0, Kotlin 2.1.20, JDK 17) | 37 / 36 / 24 (AGP 9.2.1, Kotlin 2.2.0, JDK 17) |

Re-read on 2026-10-17: npm `latest` = 58.0.14 (published 2026-10-16T19:51Z), `sdk-57` = 57.0.30,
`next` = 58.0.11, React Native 0.88.0 published 2026-10-15. `check-sdk-trigger.mjs --online` on the
reference app (expo 57.0.27) printed `wait [target-age]` plus `package-age` lines and `RESULT: PASS`:
no move yet, possible from 2026-10-23T19:54Z. Re-read the SDK 58 column against the stable release
before the move (rule 12): the table above was written from the 58.0.3 preview.

Expo ships several SDKs a year and fixes each one critically for a long time afterwards, so there is
no rush: the app moves when the new SDK is proven, not when it appears. `assets/sdk-lines.json`
holds these values as data for the checkers; its SDK 58 entry is a pre-release snapshot that the move
commit refreshes from the stable release.

## The trigger (all three conditions)

Move to the next SDK only when every condition holds:

1. `npm view expo dist-tags` shows `latest` on the new major, and that exact version is at least 7
   days old.
2. Every package the repo uses from the new SDK's module map (`bundledNativeModules.json`), plus
   `@react-native/jest-preset` and `@react-native/eslint-plugin` at the new React Native version, is
   published and at least 7 days old.
3. On a branch, the whole repo moves together and passes: the project gate (`npm run verify` or
   `npm run -s check:fast` plus the full test run), a clean prebuild with a Release build launched on a
   named iOS simulator and a named Android emulator (or EAS preview builds of both), the E2E flows,
   and the visual baselines with every diff opened and explained.

`check-sdk-trigger.mjs` judges conditions 1 and 2 (with `--online`, or a saved facts file; with
neither it exits 2). `RESULT: PASS` means no move is due, and each `wait` line names the unmet
condition and the first day it can hold. `RESULT: FAIL [upgrade-due]` means conditions 1 and 2 hold
while the app is still on the older SDK: the move is due and not yet done, and the `plan` lines are
this repo's move. After the move the same command prints `RESULT: PASS` again. If npm `latest` is
already two majors ahead, the check judges the next major on its own `sdk-<n>` dist-tag: SDKs move
one at a time. Condition 3 is the runbook.

A preview, beta, release candidate or `next` release is never adopted, and the 7-day wait is never
bypassed with a `min-release-age-exclude` for an SDK move: an SDK is not an urgent fix, and the first
patch releases routinely fix what the `.0` broke (dependency-management owns the release-age policy).

## Store deadlines

Two store rules can force a toolchain move whatever the SDK trigger says. `check-sdk-trigger.mjs`
reads them from `assets/store-requirements.json` and fails `store-deadline` when one in effect is not
met (a `notice` line names one that starts later):

| Store | Requirement (verified 2026-10-04) | What the check compares |
|---|---|---|
| App Store | since 2026-04-28 uploads must be built with Xcode 26 or later, with an iOS 26 SDK | every Xcode the builds use (`.xcode-version`, a toolchain module, exact EAS image names) |
| Google Play | since 2026-08-31 new apps and updates must target API 36 (Wear OS and Automotive 35, TV and XR 34); an extension can be requested until 2026-11-01 | a `targetSdkVersion` pin in the app config, else the SDK line's targetSdk |

Existing Play apps that target 34 or lower stay visible only on devices up to their target. Add a
row to `store-requirements.json` (with its source link) when Apple or Google announce a new one.

## What moves together, in one commit

The whole repo, never one part first: Expo supports one React Native version per repo, and a half
moved tree cannot be tested. The commit holds:

- `package.json` (`expo` and every Expo-managed package, rewritten by `npx expo install
  expo@~<version>` and `npx expo install --fix`); when multi-package, every app's `package.json`;
- the root tools that follow the SDK, in one `npm install -D`: `jest-expo` and `eslint-config-expo`
  (the module map's version), `@react-native/jest-preset` and `@react-native/eslint-plugin` (equal to
  React Native), `@types/react` and `test-renderer` (the new React line), and `jest`, `babel-jest`
  and `@types/jest` when the SDK's jest-expo peers on a new Jest line (SDK 58: Jest 30);
- the root `overrides` (every key already there moves to the version the app installs; when
  multi-package also `react`, `react-native`, `react-native-reanimated`, `react-native-worklets` and
  every native module a shared package lists as a `"*"` peer);
- `package-lock.json`, `allowScripts` changes, the code migrations of the SDK's change list, eas.json
  images that name an SDK, Android SDK pins that fell behind, explained baseline updates;
- the app's `contracts/dependency-policy.json` rows (`sdk`, `verified` and every Expo-managed row;
  dependency-management checks them with `table-sdk` and `table-map`), and the app's own
  `contracts/expo-sdk-lines.json` entry if it had to write one (references/sdk-lines.md).

## What never moves with an SDK

What Expo's related packages and the SDK's jest-expo do not move stays: TypeScript (6.0 for SDKs 57
and 58), ESLint 9, Prettier, React Navigation, and packages outside Expo's map. Each has its own
held-back trigger in dependency-management's policy. `check-sdk-alignment.mjs` fails `held-back` when
a tool rides ahead of the SDK's line (TypeScript 7, or Jest 30 on SDK 57) and `sdk-tooling` when it
stays behind a line the SDK needs (Jest 29 on SDK 58). Two moves in one commit make a failure
impossible to attribute.

## Toolchain policy in short

- **Xcode (local lane):** selected by version through `DEVELOPER_DIR`, never `sudo xcode-select`;
  the version lives in one place the checkers read (`.xcode-version`, or the `XCODE_VERSION`
  constant of the build tooling that ios-simulator-build sets up).
- **EAS (default lane):** no `image` (EAS picks `auto`, the image for the app's SDK and React Native
  version), `sdk-<n>`, or an exact image name; never `latest`, which EAS moves with every new image.
- **Android:** compileSdk, targetSdk and minSdk follow the SDK; an `expo-build-properties` pin is
  written only on purpose and moves with the SDK. The JDK follows React Native (17 for SDKs 57 and
  58).
- **A new Xcode major on an old SDK** may need extra configuration (SDK 57 with Xcode 27 needs scene
  support). Details and commands: references/toolchain.md.

## Node is not part of an SDK move

The project's Node version (`.nvmrc` or `engines`) changes in its own commit through
dependency-management, never in the SDK commit: two changes in one commit make a failure impossible
to attribute. The same holds for an npm upgrade.

## Human steps and stop-and-ask points

- Before the branch: tell the developer the trigger is met and what will change (one message with a
  default: proceed on the branch).
- Installing or updating Xcode, accepting its licence, downloading a simulator runtime or an Android
  system image, `sudo`: a human's.
- Merging the branch, pushing, EAS builds that spend build credits, store uploads and OTA updates:
  only with the developer's go.
- A gate that fails for a reason the change list does not explain, or a baseline diff that changes
  what a user sees: stop and report with the evidence; never loosen a gate or re-accept a baseline to
  get green.

## Checking the facts yourself

```sh
npm view expo dist-tags                       # latest / sdk-57 / next
npm view expo time --json                     # publish date of each version
node -e "fetch('https://api.expo.dev/v2/versions/latest').then((r) => r.json()).then((j) => {
  for (const sdk of ['57.0.0', '58.0.0']) { const x = j.data.sdkVersions[sdk] ?? {};
    console.log(sdk, x.expoVersion, x.facebookReactNativeVersion, x.facebookReactVersion, JSON.stringify(x.relatedPackages)); } })"
npm view jest-expo@<map version> peerDependencies   # the Jest line the SDK needs
node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-trigger.mjs . --online --save-facts reports/sdk-trigger.json
```

On 2026-10-04 the versions API listed SDK 57 as expo ~57.0.26 with React Native 0.86.3 / React
19.2.3, and SDK 58 as expo ~58.0.3 with 0.88.0-rc.3 / 19.3.0; both still list `jest ~29.7.0` among
the related packages although jest-expo 58.0.7 peers on `jest ^30.0.0` (the peer is what npm
enforces). `check-sdk-trigger.mjs . --online` on an SDK 57 app printed `wait [target-stable] SDK 58
is not stable yet: expo "latest" is 57.0.26 (next: 58.0.3)` and `RESULT: PASS`: not yet.
