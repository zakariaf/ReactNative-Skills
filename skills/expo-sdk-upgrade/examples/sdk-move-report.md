# Example: the developer messages around an SDK move

Three short messages in plain words for a Tasks app: the "not yet", the "ready to start", and the
finished move. Lead with what it means for the app and its users, then at most one request (with a
default where silence is safe; a merge waits for an explicit yes), then the evidence. The version numbers after `~58.0.` and `0.88.` are illustrative; the real
ones come from the trigger check's plan.

## 1. Not yet (the check at a session start)

Command and result:

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-trigger.mjs . --online
sdk      app on Expo SDK 57; target SDK 58; npm latest 57.0.27, next 58.0.0-preview.9
age      7 days (no .npmrc: the 7-day floor), measured at 2026-11-02T12:00Z
wait     [target-stable] SDK 58 is not stable yet: expo "latest" is 57.0.27 (next: 58.0.0-preview.9); betas, previews and "next" releases are never adopted
verdict  no SDK move due: stay on SDK 57; check again at the next session start
check-sdk-trigger: 2 trigger conditions and packages checked, 0 problems
RESULT: PASS
```

`RESULT: PASS` here means "no move is due": staying is the correct, finished outcome (exit 0). A
stable but young release prints its moment instead, measured to the minute as npm measures it at
install time (the `age` line comes first in every run):

```text
age      7 days (no .npmrc: the 7-day floor), measured at 2026-11-02T12:00Z
wait     [target-age] expo 58.0.2 was published 2026-10-30T09:00Z; it is not 7 days old at 2026-11-02T12:00Z (never add an exclude for an SDK move); possible from 2026-11-06T09:00Z
verdict  no SDK move due: stay on SDK 57; the trigger can hold from 2026-11-06T09:00Z; check again then
```

Message (only when the developer asked, or once a month):

> The app stays on the current Expo version (SDK 57). The next one (SDK 58) is out as a pre-release
> but not yet Expo's main release; it becomes eligible 7 days after it is. Nothing for you to do.

## 2. Ready to start

When `check-sdk-trigger.mjs` reports `FAIL [upgrade-due]` (its `plan` lines follow):

> Expo SDK 58 has been stable for more than a week and every part the app uses is out and old
> enough. I will move the app to it on a separate branch: new React Native, new gesture and animation
> libraries, Jest 30 for the tests, newer Android build tools. Nothing reaches the main line until every
> check, the iOS and Android release builds, the end-to-end runs and the screenshot comparison are
> green and you have seen the result. If you would rather wait, tell me; otherwise I start now.

## 3. Finished move (before merging)

> The app now runs on Expo SDK 58 on the branch `chore/expo-sdk-58`; users will see no difference.
> Every check passed: the full test suite, release builds that launched on an iPhone simulator and an
> Android emulator, the end-to-end flows, and the screenshot comparison (light and dark, phone and
> tablet, English and Arabic).
>
> One request: may I merge the branch into the main line? Until you say yes, it stays on
> `chore/expo-sdk-58`, unmerged.
>
> What to look at, if you want: the chart screenshots in `reports/screenshots/index.html` changed
> slightly (anti-aliasing from the new drawing library); I compared each one and accepted 6 of them.
>
> Not verified: builds on a real phone, and the store builds (the next release's first step). Phones
> on the old version keep their current update channel until they install the new build.

Evidence kept under `reports/` (git-ignored): `sdk-trigger.json` (the npm facts of the
`upgrade-due` run), the `check-sdk-alignment.mjs` output (`RESULT: PASS`), the trigger check after
the move (`RESULT: PASS`: no move due), `npx expo-doctor` and `npx expo install --check`, `npm ls
react react-native react-native-reanimated react-native-worklets` (one version each), the gate log,
the iOS and Android build and E2E logs, and the screenshot diff summary.

## The move commit

```text
build(deps): move the app to Expo SDK 58

expo ~58.0.4, react-native 0.88.1, react 19.3.0, Reanimated 4.7.0,
Worklets 0.13.0, Gesture Handler ~3.2.1, Skia 2.13.1; jest-expo,
eslint-config-expo, @react-native/*, @types/react, test-renderer and
Jest 30 follow. Swipe and long-press gestures use the Gesture Handler 3
hooks; config plugins import expo/config-plugins; Jest uses the
Reanimated resolver; the compileSdk 36 pin is gone. Gate, iOS and
Android release builds, E2E and the screenshot matrix pass; 6 chart
goldens re-accepted after review (Skia anti-aliasing).

Gate-Change: Jest resolver and re-accepted goldens for Expo SDK 58
```
