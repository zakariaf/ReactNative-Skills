# Worked example: adding expo-haptics for task-completion feedback

A complete run of "add a package that is in the policy" in a single Expo app (a Tasks app: a light
haptic tick when a task is checked off). `expo-haptics` has a row in `contracts/dependency-policy.json`
and nothing installs it yet. The plan output below is real (2026-10-03, npm registry facts).

## 1. Plan

```sh
node ${CLAUDE_SKILL_DIR}/scripts/plan-dependency.mjs expo-haptics . --online
```

```text
package  expo-haptics ~57.0.3 (Expo-managed; belongs in dependencies) - haptic feedback behind HapticsPort (audio-and-haptics-feedback)
present  nowhere yet
step 1   npx expo install expo-haptics@~57.0.3
step 2   npm approve-scripts --allow-scripts-pending   (must print "No packages with unreviewed install scripts."; an install that stopped with ESTRICTALLOWSCRIPTS ran nothing: review each package it names, add its pinned key, run the install again)
step 3   npx expo install --check && npx expo-doctor
step 4   npm run -s check:unused   (knip: the package must be imported by the code that needed it)
step 5   node ${CLAUDE_SKILL_DIR}/scripts/check-deps-policy.mjs .   (one-version and companion catch a copy that floated in)
step 6   native change: rebuild the binaries (npx expo prebuild --clean, then a development build on a named iOS simulator and Android emulator, or eas build --profile development with a simulator profile: ios.simulator true, an APK for Android); before the next release, a preview or release build on both too, and read the podspec and build.gradle for build-time downloads (references/procedures.md, "After a native change")
note     keep the @<spec> in each npx expo install: it writes the policy's specifier. ...
age      expo-haptics@57.0.3 was published 2026-09-11 (22 days before 2026-10-03T12:56Z; the .npmrc asks for 7)
licence  MIT
scripts  no install scripts
plan-dependency: 1 requests checked, 0 problems
RESULT: PASS
```

The plan passed: the package is in the policy, old enough, not deprecated, MIT, without install
scripts, so there is no `review first` step before the install. No companions and no overrides:
`expo-haptics` has no peers that float. (A package with a `postinstall`, such as Skia, gets a
`step 1   review first: … runs postinstall: …` line: read the script and write its pinned key into
`allowScripts` before running the install step.)

## 2. Install with the row's spec

```sh
npx expo install expo-haptics@~57.0.3
npm ls expo-haptics          # one version: 57.0.3
```

`package.json` now holds `"expo-haptics": "~57.0.3"` under `dependencies`. The tilde is correct: it
is what `npx expo install` writes for an Expo-managed module even with `save-exact=true`, and the
`@~57.0.3` keeps it on the policy's spec on a day Expo publishes a newer patch.

## 3. Approvals and Expo alignment

```sh
npm approve-scripts --allow-scripts-pending   # No packages with unreviewed install scripts.
npx expo install --check                      # Dependencies are up to date
npx expo-doctor                               # all checks pass
```

If the install on a Mac stops with `npm error code ESTRICTALLOWSCRIPTS` naming
`fsevents@2.3.3 (install: (install scripts present))` (a transitive package of Jest that the app has
not approved yet), nothing ran. Read it (`npm view fsevents@2.3.3 scripts` prints
`install: node-gyp rebuild`; it compiles the file-watching addon locally), add
`"fsevents@2.3.3": true` to `allowScripts` in the root `package.json`, and run the install again.

## 4. The code that needed it, in the same change

The adapter `src/services/haptics/expo-haptics-adapter.ts` is the only file that imports
`expo-haptics` (the port and the fake live beside it; audio-and-haptics-feedback owns their shape):

```ts
// src/services/haptics/expo-haptics-adapter.ts (shape only)
import * as Haptics from 'expo-haptics';

import type { HapticsPort } from './haptics-port';

export const expoHapticsAdapter: HapticsPort = {
  taskCompleted: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
};
```

Without it, `check-deps-policy.mjs` fails with `unused-dependency` for `expo-haptics` and
`npm run -s check:unused` reports it as unused.

## 5. Checks

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-deps-policy.mjs .   # RESULT: PASS
npm run -s check:fast
npm run -s check:unused
```

`expo-haptics` is a native module, so the installed development builds do not have it:
`npx expo prebuild --clean`, then a development build on a named iOS simulator (ios-simulator-build)
and a named Android emulator (android-emulator-build), and feel the tick on both (Android needs the
device's touch feedback on; a simulator plays no haptics, so the last check is on a device).

## 6. Commit

```text
feat(tasks): a haptic tick when a task is completed

Installs expo-haptics ~57.0.3 (Expo SDK 57 module map) with npx expo install
and adds the adapter behind HapticsPort. Published 2026-09-11 (22 days old),
not deprecated, MIT, no install scripts. expo install --check and
expo-doctor pass; development builds launch on iOS and Android.
```

No `Gate-Change:` trailer: neither `.npmrc` nor the policy changed (the row already existed).

## 7. The line for the developer's report

"Checking off a task now gives a light haptic tick on iPhone and Android. This added one standard
Expo module (no network access, MIT licence); all checks pass and both development builds launch."
