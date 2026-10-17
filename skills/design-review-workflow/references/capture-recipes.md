# Capturing the sweep

How to capture every cell and every motion video on named simulators and emulators, in the order that
changes device settings least, so that the captures differ only where the app differs. The commands
are what `templates/scripts/design-review/device-settings.ts` returns; the order is what
`review-cells.ts` `captureCombinations()` returns.

## Contents

- Before the first capture
- Devices: create your own, never use a shared one
- The capture order
- One combination, step by step
- Opening a cell and waiting for it
- Turning a device to landscape
- iOS commands
- Android commands
- Motion videos
- Pitfalls and fixes
- What was verified, and how

## Before the first capture

1. Every gate and test is green on the commit you sweep (`npm run verify`), and the commit is in the
   record (`build.commit`, `build.verify: "pass"`). The review judges only what machines cannot.
2. `node ${CLAUDE_SKILL_DIR}/scripts/check-review-plan.mjs .` prints `RESULT: PASS`.
3. `node ${CLAUDE_SKILL_DIR}/scripts/new-review.mjs .` wrote `design-review/<review-id>/review.json`
   and made `reports/design-review/<review-id>/cells/` and `motion/`.
4. The preview Release build (the plan's only variant: the link in step 2 below needs it) is built
   and installed on each device (ios-simulator-build
   for the iOS Release simulator app, android-emulator-build for the Android one). A JavaScript-only
   bundle swap is fine while iterating, never for the captures of record.

## Devices: create your own, never use a shared one

Each plan device names its own simulator or emulator (`tasks-review-iphone-small`). Create it once,
target it only by UDID or serial, and shut down only what you created:

```sh
# iOS: create on the pinned runtime, then use the printed UDID everywhere.
UDID=$(xcrun simctl create tasks-review-iphone-small "iPhone SE (3rd generation)" com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcrun simctl bootstatus "$UDID" -b

# Android: an AVD of the plan's hardware profile, on its own console port (its serial is emulator-<port>).
avdmanager create avd --name tasks-review-android-small --device small_phone --package "<the pinned system image>"
emulator -avd tasks-review-android-small -port 5560 -no-snapshot-save &
SERIAL=emulator-5560
adb -s "$SERIAL" wait-for-device
```

At the end: `xcrun simctl shutdown "$UDID"` and `xcrun simctl delete "$UDID"`;
`adb -s "$SERIAL" emu kill` and `avdmanager delete avd --name tasks-review-android-small`.
ios-simulator-build's `scripts/ios/simulators.ts` does the iOS half with checks (the warm-up, the
`en_US` region for a 9:41 clock).

## The capture order

`captureCombinations(plan, screens, reviewId)` returns combinations device by device, then theme, text
size and locale, each with its cells. Device settings change at most once per combination, the
language once per locale, and nothing between two cells of a combination:

```
for each device (in parallel):        create/boot it, install the build, clean status bar, orientation
  for each theme:                     appearance
    for each text size it sweeps:     content_size / font_scale
      for each locale:                debug link: lang=<locale>&theme=system&motion=still
        for each cell:                open the state, wait for its root testID, screenshot (upright)
reset the status bar, orientation, text size and appearance; shut the device down
```

## One combination, step by step

0. Once per device, before its first combination: the clean status bar (`cleanStatusBarCommands`) and
   the planned orientation (next section).
1. Set the appearance (`appearanceCommand`) and the text size (`textSizeCommand`).
2. Open `<scheme>://debug/setup?<combinationQuery(locale)>`: the language (a saved setting, so path
   cells keep it), the app theme on "system", motion held still. Every combination opens this link,
   so the sweep runs only on the preview build (production strips the link) and
   `contracts/debug-links.json` declares `lang` (every plan locale), `theme` (`system`) and `motion`
   (`still`); check-review-plan's `plan-open` fails a contract without them before any capture. A right-to-left language restarts the
   app once through rtl-and-direction's guard; wait for the home screen's root testID after it.
3. For each cell: one Maestro run opens its `open` entry (a debug-link query is appended to the same
   `debug/setup` link; a path is `<scheme>://<path>`), waits for the screen's root testID from the
   screen contract and for animations to end, and exits. Then the runner captures the cell itself:
   `screenshotCommands(device, file, orientation)`, which writes an upright PNG to the cell's file.
   Maestro never takes the cell's screenshot, so every cell is captured one way.
4. After the last combination of a device, `resetStatusBarCommands`, `resetOrientationCommands` and
   the default text size and appearance, so the next session finds the device as it was.

Links are opened through Maestro's `openLink`, which also accepts iOS's "Open in ...?" prompt
(`examples/open-cell.yaml` is the shape; e2e-maestro owns the flows and the Maestro runner, and every
run names its device: `maestro --device "$UDID" --driver-host-port "$PORT" test ...`).

## Opening a cell and waiting for it

- Wait for the screen's root testID (`tasks.list`, `not-found.screen`), never a fixed sleep. A capture
  of a half-drawn screen is a wrong cell that looks right.
- Then wait for animations to end (Maestro `waitForAnimationToEnd`). With `motion=still` loops rest and
  celebrations show their end state through the same `useReduceMotion()` path real users take; a loop
  that still moves ignores the hook, which is a finding (motion-and-animation).
- Data must be the review fixture's data, not whatever the device had: the debug link's seed or the
  app's test fixture. A cell with someone's leftover tasks compares nothing next time.

## Turning a device to landscape

The plan sweeps every large screen in landscape (and every device of a landscape app). `review-capture`
fails a shot whose width and height do not match the planned orientation, so the capture must come
out upright.

- **iOS:** simctl has no rotation command (Xcode 26.6). The flow turns the simulator with Maestro's
  `setOrientation: LANDSCAPE_LEFT` (`maestroOrientation('landscape')`; `examples/open-cell.yaml` runs
  it on iOS before every link, and the simulator keeps the orientation after the run). `simctl io
  screenshot` then still writes the device's portrait frame buffer (1488 x 2266 on an iPad mini) with
  the landscape picture on its side, so `screenshotCommands` adds a quarter turn back with macOS's
  `sips`:

  ```sh
  xcrun simctl io "$UDID" screenshot --type=png "$FILE"
  sips --rotate 270 "$FILE"            # LANDSCAPE_LEFT; LANDSCAPE_RIGHT would need --rotate 90
  ```

  Always use `LANDSCAPE_LEFT`, so one angle fits every shot. Motion videos are recorded in the frame
  buffer's orientation too: record them on a portrait device.
- **Android:** turn auto-rotate off, then set the rotation counted from the device's natural
  orientation (0 natural, 1 a quarter turn). Phones are naturally portrait; the `medium_tablet` and
  `pixel_tablet` AVD profiles are naturally landscape, so 0 is already landscape there
  (`orientationCommands(target, orientation, natural)`). `screencap` follows the rotation.

  ```sh
  adb -s "$SERIAL" shell settings put system accelerometer_rotation 0
  adb -s "$SERIAL" shell settings put system user_rotation 1          # portrait-natural phone -> landscape
  adb -s "$SERIAL" exec-out screencap -p > "$FILE"                    # 1280 x 720 on small_phone
  adb -s "$SERIAL" shell settings put system user_rotation 0
  adb -s "$SERIAL" shell settings put system accelerometer_rotation 1
  ```

- A wrong natural orientation or a missed rotation shows up as a `review-capture` orientation failure,
  never as a quiet wrong cell.

## iOS commands

```sh
xcrun simctl ui "$UDID" appearance dark                                   # light | dark
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large  # or large (the default)
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --operatorName '' --batteryState discharging --batteryLevel 100
xcrun simctl io "$UDID" screenshot --type=png "reports/design-review/$REVIEW/cells/$CELL.png"
xcrun simctl status_bar "$UDID" clear
```

- `content_size` takes the categories `extra-small` ... `extra-extra-extra-large` and
  `accessibility-medium` ... `accessibility-extra-extra-extra-large` (`xcrun simctl help ui`, Xcode
  26.6). Set it before the combination's link; React Native reads the category into `fontScale`.
- Status-bar overrides are lost on every reboot: apply them after each boot. `discharging` at 100 draws
  a plain full battery; `charged` draws a bolt.
- There is no simctl switch for Reduce Motion, Bold Text or Display Zoom (Xcode 26.6). The stills do
  not need it (`motion=still`); the reduced videos are recorded after switching Settings > Accessibility
  > Motion > Reduce Motion by hand in the simulator.

## Android commands

```sh
adb -s "$SERIAL" shell cmd uimode night yes                              # yes = dark, no = light
adb -s "$SERIAL" shell settings put system font_scale 2.0                # 1.0 = the default
adb -s "$SERIAL" shell settings put global sysui_demo_allowed 1
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command enter
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e mobile hide
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
adb -s "$SERIAL" exec-out screencap -p > "reports/design-review/$REVIEW/cells/$CELL.png"
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command exit
```

- `cmd uimode night` needs Android 10 or later; the app follows it only with `expo-system-ui`
  installed and `userInterfaceStyle` set (Expo docs).
- `font_scale` 2.0 is the largest Android 14 and later offer in Settings. It is a configuration
  change: depending on the activity's `configChanges` the app is updated in place or its activity is
  recreated, so set the text size before the combination's link and wait for the root testID again
  (not verified on an emulator by this skill).
- Use `exec-out`, never `shell screencap` piped: `shell` may rewrite line endings and corrupt the PNG.
- Demo mode is SystemUI's documented test mode; it must be allowed first (`sysui_demo_allowed 1`) and
  is left with `-e command exit`.
- Reduce motion: `adb -s "$SERIAL" shell settings put global transition_animation_scale 0`, plus
  `window_animation_scale` and `animator_duration_scale`; `1` restores them (`reduceMotionCommands`).
  React Native 0.86 observes `transition_animation_scale` live.

## Motion videos

For each moment of `motion.record`, per platform, two videos named
`<moment>--<platform>--full.mp4` and `<moment>--<platform>--reduced.mp4`.

First, on each device, put motion back in the system's hands: the stills opened every combination
with `motion=still`, and debug-menu-and-test-hooks saves that override, so it survives relaunches and
would force reduced motion into every full video. Open `<scheme>://debug/setup?motion=system`
(`VIDEO_QUERY` in review-cells.ts) and wait for a root testID. Record the full take with the system's
Reduce Motion off, then turn it on for the reduced take (iOS: Settings > Accessibility > Motion >
Reduce Motion in the simulator, by hand; Android: `reduceMotionCommands(target, true)`), and turn it
off again afterwards (`reduceMotionCommands(target, false)`).

```sh
xcrun simctl io "$UDID" recordVideo --codec=h264 --force "reports/design-review/$REVIEW/motion/press--ios--full.mp4" &
REC=$!
# trigger the moment twice: once to the end, once tapping mid-animation
kill -INT "$REC"; wait "$REC"             # simctl writes the end of the movie, then exits

adb -s "$SERIAL" shell screenrecord --time-limit 180 /sdcard/design-review-capture.mp4 &
REC=$!
# trigger the moment twice
adb -s "$SERIAL" shell pkill -INT screenrecord
wait "$REC"                               # the adb process exits once screenrecord has finished the MP4
adb -s "$SERIAL" pull /sdcard/design-review-capture.mp4 "reports/design-review/$REVIEW/motion/press--android--full.mp4"
adb -s "$SERIAL" shell rm /sdcard/design-review-capture.mp4
```

`recordVideoCommands` returns these: `stop` is the on-device interrupt on Android and `null` on iOS
(send SIGINT to the start process); either way the runner waits for the start process to exit before
`after` pulls the file. Pulling straight after the stop races with screenrecord writing the end of
the MP4 and can fetch a file no player opens.

- Record with `--codec=h264` on iOS: the default HEVC does not play everywhere a reviewer looks.
- In each video: the moment plays to its end, then once more with a tap mid-animation (it must resolve
  to the end state and never block the tap), and once while leaving and re-entering the screen for a
  loop. The reduced video shows the declared reduced alternative (`fade`, `instant`, `static`, `none`).
- `screenrecord` stops at 180 s at most and records no audio. Haptics are felt on real hardware in the
  device pass, never judged from a video.

## Pitfalls and fixes

| Symptom | Cause | Fix |
|---|---|---|
| light and dark cells are identical (`review-axis`) | appearance not applied, or the app theme setting left on light | set the appearance before the combination and `theme=system` in the link |
| two locales identical | the link's `lang` refused (a typo refuses the whole link) or the restart not awaited | read `debug.setup-error`; wait for the root testID after the restart |
| default and largest identical | content size set after launch on a screen that ignores it, or text capped at 1 | set it before opening the cell; an app that ignores text size is a BLOCKER |
| full and reduced videos look the same | `motion=still` left on from the stills (a saved override) | open `debug/setup?motion=system` before the videos, then flip the system's Reduce Motion for the reduced take |
| blank capture (`review-capture`) | black first frame, white flash, an empty window | wait for the root testID, then for animations to end |
| status bar shows `09:41` or a bolt | the Mac's 24-hour region; `--batteryState charged` | `en_US` region at simulator creation; `discharging` at 100 |
| "Open in ...?" covers the screen | `simctl openurl` with a custom scheme | open links through Maestro `openLink` (it accepts the prompt) |
| captures of one device differ in size | another model, a rotated device, a split window | one device per plan device, its planned orientation |
| a landscape iPad shot is portrait (`review-capture`) | simctl wrote the portrait frame buffer, or the flow did not rotate | `setOrientation: LANDSCAPE_LEFT` in the flow and `screenshotCommands(..., 'landscape')` (the `sips` turn) |
| an Android tablet shot is in the wrong orientation | the natural orientation given to `orientationCommands` is wrong | `medium_tablet` and `pixel_tablet` are naturally landscape |
| a pulled Android video does not play | pulled before screenrecord finished | stop with `pkill -INT screenrecord`, wait for the recording adb process to exit, then pull |
| an Android tablet shows the phone layout stretched | portrait lock ignored at 600 dp on Android 16 | a layout finding (adaptive-layout), not a capture problem |

## What was verified, and how

- iOS commands: run on 2026-10-14 through `device-settings.ts` itself (Node type stripping) on a
  simulator created for the run (iPhone SE (3rd generation), iOS 26.5, Xcode 26.6), then deleted: the
  status bar override, `appearance` light and dark, `content_size` large and
  accessibility-extra-extra-extra-large and `io screenshot` gave four 750 x 1334 PNGs, each different
  (so `review-axis` passes a real sweep), which check-lib decodes in about 0.1 s each. The fresh
  simulator showed `09:41`: the 24-hour region pitfall above. The fontScale values come from
  accessibility-as-code's simulator runs.
- Rotation, run on 2026-10-14 with Maestro 2.10.0 on simulators and an emulator created for the run,
  then deleted: on an iPad mini (A17 Pro) simulator (iOS 26.5), `setOrientation: LANDSCAPE_LEFT` and
  `LANDSCAPE_RIGHT` turned the picture, `simctl io screenshot` still wrote 1488 x 2266 with the picture
  on its side, and `sips --rotate 270` (left) or `90` (right) gave an upright 2266 x 1488 shot that
  check-lib decodes. On an Android 15 emulator (`small_phone`, API 35 image), `accelerometer_rotation 0`
  plus `user_rotation 1` gave an upright 1280 x 720 `screencap`.
- Android video stop, same emulator: `screenrecord` stopped by `pkill -INT screenrecord`, the local
  adb process exited about 0.1 s later, and the pulled file was a complete MP4 (`ftyp` and `moov`).
- Maestro per-run time, same emulator: 11 to 15 s per `maestro test` run once the driver was
  installed (the first runs took 30 s and more); the cost section of sweep-matrix.md uses it.
- Other Android commands: Android's `cmd uimode`, `settings`, SystemUI demo mode and `screencap`
  documentation (2026-10-14); appearance, font scale and demo mode were not run on an emulator here.
- The checkers: the self-test (112 runs) and a run on a copy of the reference Tasks app with generated
  captures. No sweep of a real build was captured while writing this skill.

Re-verify: `xcrun simctl help ui`, `xcrun simctl io help`, `adb -s <serial> shell cmd uimode help`.
