# Emulator commands: every step of the run, by hand

Every command `build:android:emu` runs, in order, with the reason for each flag, so a failing step can
be rerun alone and the script can be changed safely. `<prefix>-<purpose>` is the AVD
(`tasks-smoke`), `<serial>` its adb serial (`emulator-5556`), `<pkg>` the variant's package.

## Contents

- Hardware profiles and screen sizes
- Create the AVD
- Ports and serials
- Start, wait for the boot, confirm the AVD
- Prepare the screen
- Install and cold start
- The ready signal
- Crash evidence
- Screenshot
- Deep links
- Background jobs (for other skills' device proofs)
- Cleanup
- Timings
- Pitfalls

## Hardware profiles and screen sizes

The contract's `device` is an `avdmanager` hardware profile (`avdmanager list device -c` lists them).
Sizes read from the device definitions of cmdline-tools 16.0 on 2026-10-14 (portrait):

| Profile | Pixels | Density | Use |
|---|---|---|---|
| `pixel_8` (default) | 1080 x 2400 | 420 dpi | the common phone size |
| `medium_phone` | 1080 x 2400 | 420 dpi | the generic phone of newer tools |
| `pixel_8_pro` | 1344 x 2992 | xxhdpi | a large phone |
| `pixel_7_pro` | 1440 x 3120 | 560 dpi | the largest phone |
| `small_phone` | 720 x 1280 | xhdpi | small screens, large text |
| `pixel_fold` | 1840 x 2208 | 420 dpi | a foldable's inner screen |
| `pixel_tablet`, `medium_tablet` | 1600 x 2560 | xhdpi | tablets (they boot in landscape) |

`check-emu-screenshot` knows these sizes; another profile needs `--size WxH`. A newer profile
(`pixel_9`) exists only in newer cmdline-tools: check `avdmanager list device -c` first.

## Create the AVD

```sh
echo no | avdmanager create avd --name <prefix>-<purpose> \
  --package 'system-images;android-36;google_apis;arm64-v8a' --device pixel_8
```

- `--name` is always `<prefix>-<purpose>` (`avdName()`); tooling never creates, starts or deletes
  another name (`check-emu-setup` `emulator-avd`).
- `echo no` answers "Do you wish to create a custom hardware profile?".
- The AVD lives in `~/.android/avd/<name>.avd` with its `config.ini`; `emulator -list-avds` lists it.
  The run creates it only when the list lacks it, so a second run reuses it.

## Ports and serials

An emulator listens on a console port (even, 5554 to 5584 for adb to find it) and adb on the next one;
its serial is `emulator-<console port>`. The run lists `adb devices`, takes the first even port no
listed emulator uses (`pickConsolePort`) and starts the emulator on it, so it knows the serial before
the emulator exists. At most sixteen emulators fit on one machine in that range.

## Start, wait for the boot, confirm the AVD

```sh
emulator -avd <prefix>-<purpose> -port 5556 -no-snapshot-save -no-boot-anim -no-audio -no-window \
  > build/android-emu/logs/emulator.log 2>&1 &
adb -s emulator-5556 wait-for-device
adb -s emulator-5556 shell getprop sys.boot_completed      # poll until it prints 1
adb -s emulator-5556 emu avd name                          # prints the AVD name, then OK
```

- `-avd` by name and `-port` by choice (`emulatorArgs()`); never "the first emulator".
- `-no-snapshot-save` leaves the quick-boot snapshot as it was, so a crashed app state is never saved
  into the next boot; `-no-window` runs headless (screenshots come from adb, not the window); boot
  animation and audio are skipped.
- The script polls `getprop sys.boot_completed` every second for up to five minutes (a cold boot of a
  new AVD took 25 s on Apple silicon and can take three minutes on a loaded or unaccelerated machine).
- `emu avd name` asks the emulator's console which AVD it runs. The run refuses a serial whose answer
  is not its AVD (`assertAvdBehind`): a port can have been taken by another session between the
  `adb devices` listing and the start.
- When the AVD is already running (any port), `findRunningAvd` finds its serial by asking every
  listed emulator's console, and the run uses it as it is and leaves it running.

## Prepare the screen

```sh
adb -s <serial> shell wm dismiss-keyguard
adb -s <serial> shell settings put global sysui_demo_allowed 1
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command enter
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command network -e mobile hide
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
```

System UI's demo mode draws a fixed status bar (9:41, full battery not charging, full Wi-Fi, no
notification icons; `fully true` drops the "no internet" mark an emulator otherwise shows on the
Wi-Fi icon), so two screenshots of the same screen are byte-identical and the reviewer sees no
stray icon. Every boot resets it, so the run sends it after each boot. The icons are drawn in the colour the app
asks for: an app that never sets its status bar style can end up with light icons on its light header,
invisible in the screenshot (seen on the reference app, `examples/variant-proof.md`); that is the
app's bug (an `expo-status-bar` `StatusBar` with `style="auto"`), not the build's. Animations stay on: React Native's
AccessibilityInfo and Reanimated read `transition_animation_scale` 0 as Reduce Motion (verified 2026-10-14 in
the sources: `AccessibilityInfoModule.kt` and Reanimated's `NativeProxy.kt` read
`Settings.Global.TRANSITION_ANIMATION_SCALE`), so switching the scales off would screenshot the reduced-motion
app; `animator_duration_scale` 0 alone does not turn on Reduce Motion, but it makes Android's own animators
instant, so the screenshot no longer shows what users see either.

## Install and cold start

```sh
adb -s <serial> uninstall <pkg>                     # ignore "Unknown package" on the first run
adb -s <serial> install build/android-emu/app-preview.apk
adb -s <serial> shell cmd package resolve-activity --brief <pkg>   # last line: <pkg>/.MainActivity
adb -s <serial> logcat -b all -c
adb -s <serial> shell am start -S -W -n <pkg>/.MainActivity
```

- The uninstall makes every run a first launch with empty app data, and avoids
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE` when the installed copy was signed with another key.
- The launcher component comes from the package manager, not from a guess about the class name.
- The log buffers are cleared on this emulator only (it is the run's own), so the crash buffer read
  later holds only this launch.
- `am start -S` stops a running copy first; `-W` waits until the activity reports it launched.

## The ready signal

Every 500 ms, for at most 45 s (`emu-ready-signal.ts`), the run takes a screenshot and asks:

```sh
adb -s <serial> shell pidof <pkg>                           # the process is alive
adb -s <serial> shell dumpsys activity activities           # topResumedActivity=... <pkg>/...
adb -s <serial> logcat -b crash -d                          # no "Process: <pkg>," report
adb -s <serial> logcat -d -s <tag>                          # only with the contract's readyLog
```

Ready means: the process is alive, its activity is the resumed one (not the launcher, not a system
dialog), and either the contract's `readyLog` line was logged or two screenshots in a row are
byte-identical after at least 3 s. A crash report fails the run at once with the report; a missing
process after 2 s fails it too. A test build that logs one line once its first screen is interactive
(through `console.log`, which a Release build writes to logcat under the tag `ReactNativeJS`) can name
it in `readyLog` to end the wait early.

## Crash evidence

When the run stops with "the app crashed", the error carries the crash buffer. For more:

```sh
adb -s <serial> logcat -d -b crash                   # Java and native crash reports
adb -s <serial> logcat -d -s ReactNativeJS AndroidRuntime libc DEBUG
adb -s <serial> shell dumpsys activity processes | grep <pkg>
```

A JavaScript error that React Native turns into a fatal crash shows as
`com.facebook.react.common.JavascriptException` in the crash buffer with the JS message.

## Screenshot

```sh
adb -s <serial> exec-out screencap -p > reports/android-emu/smoke-preview.png
```

`exec-out` streams the PNG bytes without the line-ending translation `adb shell` applies, so the file
is a valid PNG (the script reads stdout as a buffer). The image has the display's current rotation.

## Deep links

```sh
adb -s <serial> shell am start -W -a android.intent.action.VIEW -d '<scheme>://tasks/42' <pkg>
```

Naming the package sends the intent to the app itself, so no chooser appears even when another
installed app (another variant) handles a similar scheme. `--link tasks/42` reads the scheme from the
merged manifest (`schemeOf`), opens the link, waits for a still screen and saves
`<purpose>-<variant>-link.png`. Flows that must wait for a particular element belong to `e2e-maestro`
(`maestro --device <serial> test ...`). The template quotes the URL for the device shell
(`deviceShellQuote`): `adb shell` joins its arguments into one line for the device's `sh`, so an
unquoted `&` in `tasks?id=1&tab=notes` would end the `am` command there.

## Background jobs (for other skills' device proofs)

Another skill's proof on the same emulator (background-tasks, for example) reuses the serial this run
printed and keeps the emulator with `--keep-emulator`:

```sh
adb -s <serial> shell input keyevent KEYCODE_HOME                    # send the app to the background
adb -s <serial> shell dumpsys jobscheduler | grep -A3 '<pkg>'        # the scheduled jobs and their ids
adb -s <serial> shell cmd jobscheduler run -f <pkg> <job id>         # run one now, constraints ignored
adb -s <serial> shell am kill <pkg>                                  # end the process, then run it again
```

What the job must do and how its result is read belong to that skill.

## Cleanup

```sh
adb -s <serial> emu kill                                   # stop this emulator only
avdmanager delete avd -n <prefix>-<purpose>                # remove the AVD and its data
```

The run stops the emulator it started unless `--keep-emulator` is given; it never stops an emulator
it found running. `stopOwnEmulator` checks the AVD name behind the serial first. Never
`adb kill-server`, `pkill qemu-system...` or `killall emulator`: they end every session's devices.

## Timings

Measured on the reference app (Apple silicon, a shared machine; see `examples/variant-proof.md`):

| Step | First run | Later runs |
|---|---|---|
| create the AVD | about 5 s | skipped |
| prebuild (clean) | about 10 s | the same |
| Gradle Release, one ABI | over 10 min (Gradle distribution, Maven, two NDK downloads) | 2.5 to 4 min (library build folders under `node_modules` stay warm) |
| boot of the AVD | 25 s (`Boot completed in 24601 ms`, API 35 image) | 0 s when it runs already |
| install, launch, ready, screenshot | about 10 s | the same |

A run on a quiet machine is about 3 minutes once the first build is done; a loaded machine doubles it.

## Pitfalls

- **`adb: more than one device/emulator`.** A call without `-s`; every call names the serial.
- **`INSTALL_FAILED_NO_MATCHING_ABIS`.** The APK holds libraries for another ABI than the image's;
  build with `-PreactNativeArchitectures=<the image's ABI>` (`check-apk` `abi`).
- **The emulator exits at once with "Running multiple emulators with the same AVD".** The AVD is
  running already (maybe started by a previous run with `--keep-emulator`); the run finds it by name.
- **A black screenshot right after boot.** The lock screen or the boot is not finished; the run waits
  for `sys.boot_completed` and dismisses the keyguard first.
- **The status bar shows notification icons.** Demo mode was reset by a reboot; the run sends it
  again after every boot.
- **"System UI isn't responding" on a cold boot of a loaded machine.** The dialog covers the app; the
  ready signal never sees the app resumed and times out. Rerun once the machine is quieter.
