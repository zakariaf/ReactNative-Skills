# Runbook: moving the app to a new Expo SDK

The exact order of work for an SDK move (written for 57 to 58, valid for later moves with the numbers
changed), the expected output of each command, the evidence to keep, and what to do when a step
fails. Read it once before starting and follow it step by step; each step names the reference that
explains it. Commands are for one app at the repo root; "When multi-package" at the end lists what
changes for npm workspaces.

## Contents

- Before the branch
- On the branch: packages
- On the branch: code
- On the branch: toolchain and data
- Verification loop (iOS and Android)
- Commit, report, merge
- When a step fails
- Rolling back
- When multi-package
- Other package managers

## Before the branch

1. **Trigger.** `node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-trigger.mjs . --online --save-facts
   reports/sdk-trigger.json`. `RESULT: PASS` means no move is due: a `wait [target-stable]` line (the
   new SDK is not npm `latest`) or an age or missing-package line, then `verdict  no SDK move due`;
   stop and report "not yet" with the day it prints (message 1 of examples/sdk-move-report.md).
   `RESULT: FAIL [upgrade-due]` means the move is due: keep its `plan` lines, which hold the exact
   versions. `FAIL [store-deadline]` is a toolchain move forced by a store (references/toolchain.md).
   Exit 2 means it had no facts (pass `--online` or `--facts <file>`).
2. **Green start.** The project gate passes on the current SDK (`npm run verify`, or
   `npm run -s check:fast` and `npm test`); `git status` is clean, and the plain
   `node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-alignment.mjs .` prints `RESULT: PASS`. The readiness
   scan below checks config plugin and Gesture Handler imports only against the target SDK's line, so
   it does not repeat the current SDK's import rules. Never start a move on a red tree: failures would
   be impossible to attribute.
3. **Readiness.** `node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-alignment.mjs . --target-sdk 58`.
   Every `FAIL` (React Native or Jest APIs the new SDK removed, an app config key it dropped, an Xcode
   too old) is fixed now, on the current SDK, in its own commit: the replacements already exist there.
   The `todo` lines (config plugin imports, Jest config, Gesture Handler builder calls, eas.json image
   aliases, Android pins, scene support) are the move commit's work list; copy them into the notes.
4. **Developer.** One message: the trigger is met, the change list in short, the default ("I will
   prepare the move on a branch and report the results before anything is merged"), message 2 of the
   example.

## On the branch: packages

5. `git switch -c chore/expo-sdk-58`.
6. **Expo-managed packages:**

   ```sh
   npx expo install expo@~58.0.N && npx expo install --fix
   ```

   `--fix` prints the packages it moves ("Installing 7 SDK 58.0.0 compatible native modules using
   npm") and rewrites their specifiers. `expo@~58.0.N` keeps the tilde form in `package.json` (Expo
   writes the specifier as given). A "Skipping config plugin check: Cannot find module
   …config-plugins.js.js" line is expected until step 10.
7. **Root tools in one command** (versions from the new module map and the plan's line 3):

   ```sh
   npm install -D jest-expo@<map> eslint-config-expo@<map> @react-native/jest-preset@<rn> \
     @react-native/eslint-plugin@<rn> @types/react@<react line> test-renderer@<react line> \
     jest@30 babel-jest@30 @types/jest@30.0.0
   ```

   The last three only when the SDK's jest-expo peers on a new Jest line (SDK 58 does). Installing
   `jest-expo` alone fails with `ERESOLVE` (it peers on the new `@react-native/jest-preset` and Jest).
   Never `--force` or `--legacy-peer-deps`.
8. **Overrides.** Every key already in the root `overrides` moves to the exact version step 6
   installed (`npm ls <pkg>`; for example `4.28.2` for `~4.28.0`, never the range floor), then
   `npm install`. The `@typescript-eslint/*` keys follow `typescript-eslint`, not the SDK; leave them.
   `npm ls react react-native` must show one version each; add an override for any duplicate
   `npx expo-doctor` names.
9. **Install scripts.** `npm approve-scripts --allow-scripts-pending`: delete approvals for scripts
   that no longer exist (a `true` approval for `@shopify/react-native-skia@2.6.x`: Skia 2.6.5 and later
   have no install script), read and approve anything new one package at a time, by its pinned key
   (dependency-management owns the review rules).

## On the branch: code

10. **Config plugins:** every `import … from 'expo/config-plugins.js'` becomes `'expo/config-plugins'`
    (type imports too) in every file that imports it, tests included: `plugins/`, `scripts/`,
    `app.config.ts`, and the config-plugin tests and helpers under `src/`, `test/` and `__mocks__/`
    (Jest fails with `config-plugins.js.js`, tsc with TS2307). `check-sdk-alignment.mjs` lists each one.
11. **Jest** (the root config unit-and-component-tests owns; a gated path, so the commit carries a
    `Gate-Change:` trailer): add `resolver: 'react-native-reanimated/jest/resolver'` to the options
    every project shares and `'^react-native/asset-registry$':
    '<rootDir>/node_modules/react-native/src/asset-registry.js'` as the first `moduleNameMapper` entry.
    With Jest 30, replace the removed alias matchers (readiness already failed on them) and check
    every `.snap` diff (references/sdk-58-changes.md, "Jest 30").
12. **Gestures:** rewrite every component that builds Gesture Handler gestures to the v3 hooks, each
    as a whole (the mapping table and a type-checked example are in references/sdk-58-changes.md);
    keep each component's gesture contract and rerun its gesture tests.
13. **Scene support:** remove the `addSceneSupport` call (or the `enableSceneSupport` entry) and
    delete `scripts/config/scene-support.ts` and its test if they exist (a no-op on SDK 58).
14. **Everything else** in references/sdk-58-changes.md that applies: `useColorScheme()` null
    handling, Skia golden review, Reanimated frame-callback recheck. Run `npm run -s typecheck` early:
    React Native 0.88 and React 19.3 types surface most of the rest.

## On the branch: toolchain and data

15. **EAS images:** an `image` naming the old SDK (`sdk-57`, an Android `…-sdk-57` image) becomes
    `auto` or `sdk-58`; an exact iOS image moves to one with the Xcode the new SDK needs
    (references/toolchain.md). `latest` is never used.
16. **Android:** delete or raise every `expo-build-properties` `compileSdkVersion`,
    `targetSdkVersion` or `minSdkVersion` pin below the new SDK's values (SDK 58: compileSdk 37,
    targetSdk 36, minSdk 24, AGP 9.2.1, Kotlin 2.2.0, JDK 17). A config plugin that edits Gradle files
    is reread against AGP 9 (expo-prebuild-and-config-plugins).
17. **Policy rows:** `contracts/dependency-policy.json` (`sdk`, `verified`, every Expo-managed row and
    the held-back entries the SDK moved) changes in this commit; dependency-management's
    `check-deps-policy.mjs` reports `table-sdk` and `table-map` until it does.
18. **SDK lines:** if this skill's entry for the new SDK is still a pre-release snapshot that differs
    from the stable release, or missing (`sdk-unknown`), write the app's
    `contracts/expo-sdk-lines.json` entry from the stable values (references/sdk-lines.md); delete it
    again once an updated skill describes the SDK.

## Verification loop (iOS and Android)

Run, fix the cause, rerun, until all pass; keep the outputs for the report:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-alignment.mjs .        # RESULT: PASS
node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-trigger.mjs . --online  # RESULT: PASS again: no move due
npx expo install --check                                           # "Dependencies are up to date"
npx expo-doctor                                                     # every check passes, no duplicates
npm ls react react-native react-native-reanimated react-native-worklets   # one version each
npm run -s check:fast && npm test                                   # or npm run verify
```

When the app keeps `contracts/native-libraries.json`, also run native-modules-and-new-architecture's
`check-native-libraries.mjs .` after `npm ci`: its `library-recheck` and `library-stale` rules name the
decision entries to revisit and the libraries that went native since the last SDK.

Then the device side (ios-simulator-build, android-emulator-build and e2e-maestro own the
commands; devices are always named, never "the booted one"):

- `npx expo prebuild --clean` (both platforms), a Release build launched on a named iOS simulator
  (`xcodebuild … -destination id=<udid>`) and on a named Android emulator (`adb -s <serial>`), or EAS
  builds of the preview profile for both (`eas build --profile preview --platform all`, which spends
  build credits: ask first).
- The E2E flows on both (`maestro --device <id> test .maestro/flows`).
- Visual baselines (golden-and-snapshot-tests): open every changed golden and screenshot; a diff is
  accepted only when the change list explains it, with a `Gate-Change:` trailer. Jest 30's new
  snapshot header link turns every golden red at once: re-accept them through run-goldens-rebaseline
  (its guarded ritual from `--start` to `--proof`); its checker recognises a header-only rewrite and
  still wants an inspection entry per file.
- OTA: the move changes the runtime version (fingerprint), so builds on the old SDK never receive
  updates published from the new one; new store builds go out before any update (ota-updates).

## Commit, report, merge

- One commit for the whole move, for example:

  ```text
  build(deps): move the app to Expo SDK 58

  expo ~58.0.N, react-native 0.88.x, react 19.3.0, Reanimated 4.7.0,
  Worklets 0.13.0, Gesture Handler ~3.2.1, Skia 2.13.x; jest-expo,
  eslint-config-expo, @react-native/*, @types/react, test-renderer and
  Jest 30 follow; overrides pin one copy of each native module. Gestures
  use the Gesture Handler 3 hooks; config plugins import
  expo/config-plugins; Jest uses the Reanimated resolver; Android
  compileSdk 37. Gate, Release builds on iOS and Android, E2E and the
  visual baselines pass; N golden diffs reviewed (Skia).

  Gate-Change: Jest resolver and re-accepted goldens for Expo SDK 58
  ```

- Report to the developer in the shape of examples/sdk-move-report.md (git-commits-and-reporting owns
  the commit and report format). Merging, pushing, EAS builds and uploads wait for the developer's go.

## When a step fails

| Symptom | Cause | Fix |
|---|---|---|
| `ERESOLVE … peer @react-native/jest-preset@"^0.88…" from jest-expo` (or `peer jest@"^30"`) | root tools installed one by one | step 7 in one command |
| `expo-doctor`: "Found duplicates for react-native-reanimated" | a stale override or a second copy at the root | step 8 overrides, `npm install` |
| `check-sdk-alignment` `duplicate-native` outside a move | a dependency (or a shared package's `"*"` peer) resolved its own copy | add the override the fix line prints (the version the app installs), `npm install` |
| `Cannot find module …/expo/config-plugins.js.js`, `TS2307 'expo/config-plugins.js'` | expo 58's exports map | step 10 |
| Jest: "`setCSSEventHandler` is not available in JSReanimated" | native Reanimated initializers loaded under Jest | step 11 resolver |
| Jest: "Could not locate module react-native/asset-registry mapped as react-native/src/asset-registry" | resolver plus React Native's exports map | step 11 mapping |
| Jest: `expect(...).toBeCalledWith is not a function` | Jest 30 removed the alias matchers | full names (readiness `removed-test-api`) |
| Gradle: compileSdk or AGP errors in a library | a library not yet on AGP 9 / compileSdk 37 | check the library's release for the new SDK; it waits like any package (trigger condition 2) |
| `npm error notarget … with a date before …` | a version younger than 7 days | the trigger was not met: stop, never add an exclude for an SDK move |
| `check-deps-policy` `table-sdk` / `table-map` | the dependency policy still describes the old SDK | step 17 |
| `check-sdk-alignment` `sdk-unknown` | no SDK line for the new SDK | step 18 |
| a gate fails for a reason the change list does not explain | a new breaking change | read the versioned release notes, fix, note it in the report; if the gate itself looks wrong, stop and ask |

## Rolling back

Nothing leaves the branch until the developer agrees, so a failed move is abandoned, not reverted:
`git switch main`, then `npm ci` (the lockfile on main still pins the old SDK), and report what
blocked the move with its evidence. Never merge a half-moved tree.

## When multi-package

With npm workspaces (`apps/*` Expo apps, `packages/*` shared packages):

- Step 6 runs in every app: `(cd apps/<id> && npx expo install expo@~58.0.N && npx expo install
  --fix)`, the same commands everywhere; `check-sdk-alignment` fails `sdk-lockstep` / `app-lockstep`
  while two apps differ.
- Step 8 also sets `react`, `react-native`, `react-native-reanimated`, `react-native-worklets` and
  every native module a shared package lists as a `"*"` peer, each at the exact version the apps
  install; without them npm keeps the old copies at the root for the peers and Jest (which resolves
  from the root) tests the wrong versions. `npm dedupe` does not fix this.
- Step 10 covers `plugins/` of every package that ships config plugins.
- The verification loop runs `npx expo install --check` and `npx expo-doctor` inside every app, and
  the device checks for every app; each app's `eas.json` is checked for images.

## Other package managers

The runbook is written for npm. With another package manager the steps are the same; these differ:

| | npm | Yarn (Berry) | pnpm | Bun |
|---|---|---|---|---|
| Overrides (steps 8, the `overrides` and `duplicate-native` fixes) | `overrides` | `resolutions` | `pnpm.overrides` (or `overrides` in `pnpm-workspace.yaml`) | `overrides` (or `resolutions`) |
| Clean install | `npm ci` | `yarn install --immutable` | `pnpm install --frozen-lockfile` | `bun install --frozen-lockfile` |
| One version each | `npm ls react react-native` | `yarn why react-native` | `pnpm why react-native` | `bun pm ls` |

`npx expo install` detects the package manager from the lockfile. `check-sdk-alignment.mjs` reads
the `overrides` field only, and its `duplicate-native` rule and the installed-version half of
`expo-min` read `package-lock.json` only: without it (a `note` line says so) they check the declared
ranges alone, so run `npx expo-doctor` (duplicate native modules) and the package manager's `why`
command by hand, and read the installed expo version from its lockfile. The release-age floor is
set per manager too (dependency-management).

