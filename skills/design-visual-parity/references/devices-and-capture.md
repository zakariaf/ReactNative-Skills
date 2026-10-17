# The parity devices and the app capture

How `setup-parity-device.mjs` and `capture-app.mjs` get a screenshot and element bounds that can be
compared with the design, on an iOS simulator and an Android emulator, and the pitfalls each step
avoids. iOS facts were measured on 2026-09-28 (macOS, Xcode 26.6, iOS 26.5 runtime, Maestro 2.10 on
Java 17); Android facts come from the platform and Maestro documentation and are not yet verified on an
emulator by this skill (marked "unverified" below).

## Contents

- The device profiles
- One device per session, always named
- iOS: the parity simulator
- Android: the parity emulator
- Launching straight into a frame
- The probe launch
- Taking the screenshot
- Element bounds with maestro hierarchy
- The launch nonce
- Fast iteration after a JavaScript-only change
- Human steps

## The device profiles

| Profile | Screen | Scale | Safe area | Masks |
|---|---|---|---|---|
| `iphone-16-pro` (iOS 26.5) | 402 x 874 pt = 1206 x 2622 px | 3 | top 62, bottom 34 | the status bar (top 62 pt) and the home-indicator strip (bottom 34 pt) |
| `android-parity` (Pixel 7 AVD, API 36) | 360 x 800 dp = 1080 x 2400 px | 3 (density 480) | top 48, bottom 24 (unverified) | the status bar and the gesture bar (unverified) |

The mockup reflows to each profile's width and height (`--parity-width`, `--parity-height`), so the
references are rendered at exactly the device's geometry; scripts read the profile, never a hard-coded
number. The Android emulator's density is pinned to a whole ratio (480 dpi = 3x): at a fractional ratio
(420 dpi = 2.625x) every edge falls between pixels and the 2 pt bounds tolerance is spent on rounding.

## One device per session, always named

Several sessions share one machine, and a call that picks "the booted simulator" or "the only device"
can reach someone else's: a Maestro hierarchy call once answered from another session's simulator (its
RTL Settings screen), even with a separate driver port. So:

- each session makes its own device, named `<project>-parity` or `<project>-parity-<key>`
  (`setup-parity-device.mjs --name tasks-parity-a`), and passes `--name` to every script;
- iOS: every `simctl` call names the UDID, never `booted` or `all`;
- Android: every `adb` call puts `-s <serial>` first; the emulator is found by its AVD name
  (`adb -s <serial> emu avd name`) and started on its own console port;
- both platforms: every Maestro call puts `--device <udid|serial> --driver-host-port <port>` before the
  command, the port picked free once per run (or `--driver-port`). Maestro 2.10 uses the port on both:
  the XCTest driver's host port on iOS, the host side of the adb forward on Android, 7001 by default,
  so two sessions without their own port share one driver;
- every launch carries a nonce the hierarchy dump must contain (below).

When the session is done, shut down only its own device (`xcrun simctl shutdown <udid>`,
`adb -s <serial> emu kill`) and stop what it started.

## iOS: the parity simulator

`setup-parity-device.mjs . --device iphone-16-pro --appearance light --name tasks-parity-a` creates the
simulator once (`xcrun simctl create` accepts the iPhone 16 Pro type with the iOS 26.5 runtime even when
Xcode lists only newer models), boots it, and pins:

- **the status bar**: `xcrun simctl status_bar <udid> override --time 9:41 --dataNetwork wifi --wifiMode
  active --wifiBars 3 --cellularMode active --cellularBars 4 --operatorName '' --batteryState discharging
  --batteryLevel 100` (`charged` would draw a bolt). Every reboot clears it; the scripts re-apply it.
- **a 12-hour clock**: a simulator inherits the host region and "9:41" renders "09:41"; the script
  writes `AppleLocale en_US`, `AppleLanguages (en)` and `AppleICUForce12HourTime` and reboots once.
- **appearance, text size, contrast**: `simctl ui <udid> appearance light|dark`, `content_size large`
  (the default body size the design uses), `increase_contrast disabled`.

`--check` changes nothing and fails with `sim-missing`, `sim-not-booted`, `sim-wrong-model`,
`sim-duplicate`, `sim-locale`, `sim-status-bar`, `sim-appearance`, `sim-content-size` or
`sim-increase-contrast`. A same-named device of the wrong model is replaced only with `--recreate`.

## Android: the parity emulator

`setup-parity-device.mjs . --device android-parity --appearance dark --name tasks-parity-a` creates the
AVD once (`avdmanager create avd --name <name> --package <system image> --device pixel_7`), starts it in
the background on a free console port (`emulator -avd <name> -port <port> -no-snapshot-save
-no-boot-anim -no-audio`), waits for `sys.boot_completed`, and pins (unverified on a device by this
skill; each step is the documented command):

- **the system image**: a same-named AVD made from another image or API level is refused
  (`emu-wrong-image`, read from `image.sysdir.1` in `<avd-home>/<name>.avd/config.ini`; `--avd-home`, else
  `$ANDROID_AVD_HOME`, else `~/.android/avd`): delete only that AVD and run the setup again;
- **the navigation mode**: gesture navigation (profile `avd.navigation`, default `gestural`), pinned with
  `adb -s <serial> shell cmd overlay enable-exclusive --category
  com.android.internal.systemui.navbar.gestural` and read back from `cmd overlay list`. With 3-button
  navigation the bottom inset is 48 dp instead of the profile's 24 dp, which moves every bottom-anchored
  element and fails `bounds` for reasons that have nothing to do with the app;
- **the display**: `adb -s <serial> shell wm size 1080x2400` and `wm density 480`;
- **the appearance**: `adb -s <serial> shell cmd uimode night yes|no`;
- **the text size**: `settings put system font_scale 1.0`;
- **demo mode** (a fixed clock, full bars, no notification icons): `settings put global
  sysui_demo_allowed 1`, then `am broadcast -a com.android.systemui.demo -e command enter`, `clock -e
  hhmm 0941`, `battery -e level 100 -e plugged false`, `network -e wifi show -e level 4`,
  `notifications -e visible false` (a setup run sends them every time; capture-app.mjs re-sends them
  before each capture).

`--check` fails with `emu-missing`, `emu-wrong-image`, `emu-not-running`, `emu-navigation`,
`emu-display-size`, `emu-display-density`, `emu-night-mode`, `emu-font-scale` or `emu-demo-mode`.
capture-app.mjs refuses a `--serial` that does not run the AVD named by `--name` and a `--udid` that is
not the simulator named by `--name` (exit 2): a stale id would launch and capture on another session's
device. The profile's insets (status bar 48 dp, gesture bar 24 dp, at density 480) and masks are still
unverified on an emulator by this skill (this round ran no emulator); measure them on the first
capture and replace the profile's values with the measured ones and the date. `emu-demo-mode` proves only the permission
(`sysui_demo_allowed 1`): demo mode itself ends on a reboot, the permission does not, and no setting
reports whether it is on. That is why the setup run and every capture send the commands again. Edge to edge is on by default from Android 15:
the app draws under the status and gesture bars, so the profile's masks, not the app, decide what is
compared there.

## Launching straight into a frame

The parity launch is one query: `frame=<key>&theme=<light|dark>&lang=<code>&date=<fixture day>&
motion=still&nonce=<hex>`, plus `scrollY=<pt>` for a tall frame and `probe=<region>` for a probe launch.

- **iOS** gets it as a launch argument, which lands in NSUserDefaults where React Native's `Settings`
  reads it (references/parity-harness.md):

  ```
  xcrun simctl launch --terminate-running-process <udid> com.example.tasks.preview \
    -AppleLanguages "(ar)" -AppleLocale ar -parity "frame=tasks-default&theme=dark&lang=ar&date=2026-10-01&motion=still&nonce=3f9a0c1d2e4b"
  ```

  `-AppleLanguages "(ar)" -AppleLocale ar` starts the app in that language and direction (the app must
  declare it in expo-localization's `supportedLocales`). capture-app.mjs passes every argument as its
  own word; in a shell an unquoted variable holding `-AppleLanguages (ar)` arrives as one word.
- **iOS never gets a deep link from outside**: `simctl openurl` raises an "Open in ...?" alert that
  nothing accepts; pending alerts dim the app and hide every testID (`screen-not-reached`).
- **Android** gets the link `<scheme>://debug/parity?<query>` sent to the named package, which opens no
  chooser, with the per-app language set first (`cmd locale set-app-locales <package> --locales ar`,
  Android 13 and later; unverified):

  ```
  adb -s emulator-5580 shell 'am start -W -a android.intent.action.VIEW -d "tasks-preview://debug/parity?frame=tasks-default&theme=dark&lang=ar&motion=still&nonce=3f9a0c1d2e4b" com.example.tasks.preview'
  ```

  The command is one shell string with the URL quoted again inside it: the device shell splits an
  unquoted URL at `&`, and only the first parameter would arrive.
- **The build** is a Release build of the development or preview variant (the test-only harness exists
  there, no dev overlay or LogBox): ios-simulator-build and android-emulator-build make and install it.
  Read the identifiers from the build (`plutil -extract CFBundleIdentifier raw -o - <App>.app/Info.plist`;
  the variant's `package`) and keep them in the contract's `launch`.
- **Nothing else in front**: on iOS another app adds a "back to" breadcrumb; capture-app.mjs
  terminates other apps first (except Maestro's driver, whose restart costs 20 s).
- **No system prompt**: capture-app.mjs checks every dump for a tracking prompt, a permission prompt,
  an "Open in ...?" alert or an Android "isn't responding" dialog (`system-alert`); a parity launch asks
  nothing, and `run.json` records `systemAlert: null`.

## The probe launch

A frame with `probe` (a map, a canvas) masks a region only the app knows. Before the capture,
capture-app.mjs launches the frame once with `probe=<region>`: no frame state opens, and the app renders
the probe element (`parity.probe.<region>`, or the contract's `probe.testID`), a small accessible element
whose label is the region's rectangle in points (`{"x":0,"y":120,"width":402,"height":480}`, or a skia
canvas probe's `{"x","y","layout":{"width","height"}}`). The rectangle goes into `run.json` (`region`), cached per
device, theme and language for the rest of a run; a probe without a usable element fails
`region-probe`, and a probed frame's run without a region stops check-parity.mjs with exit 2.

## Taking the screenshot

- iOS: `xcrun simctl io <udid> screenshot --type=png app.png` returns an sRGB PNG in about 0.16 s; the
  corners are not rounded and the home indicator is not in the image. Two screenshots of the same screen
  had 0 differing pixels, 1 s apart and across a reboot. Android: `adb -s <serial> exec-out screencap -p`.
- **A still screen**: wait 1 s, then screenshot every 300 ms until two in a row match outside the masks
  (within 3/255: hard shadows re-dither on a redraw), up to the frame's `settleMs` (8 s). A screen that
  never holds still fails `unstable`: a loop that ignores reduce motion, a timer, a loading state.
- **Late loads**: a launch screen can hold still for 300 ms; after the hierarchy dump one more
  screenshot is taken, and a change means settle and dump again (three attempts, then
  `changed-during-capture`).

## Element bounds with maestro hierarchy

`maestro --device <udid> --driver-host-port <port> hierarchy --no-reinstall-driver` (Android: `maestro
--device <serial> --driver-host-port <port> hierarchy`) prints a JSON tree; each node's `attributes` hold `resource-id` (the React
Native testID), `accessibilityText` (the label; a Text's text) and `bounds` `[x0,y0][x1,y1]`.

- **Units**: whole points on iOS (an edge at 140.67 pt reads 140, which the 2 pt tolerance includes);
  physical pixels on Android, divided by the scale (from Maestro's documentation; unverified).
- **Only on-screen elements are listed**: a partly visible element is listed with its full, unclipped
  bounds. Tall frames are captured at several offsets, and coverage is the union of the elements each
  capture shows whole.
- **Accessible elements hide their children, and hidden parts are not listed** (measured on iOS): an
  accessible Pressable is listed with its label, its inner Text not at all; a view hidden from screen
  readers is missing with everything inside it. So a testID belongs on the accessible element, and
  crop-only parts are checked through their cover's crop.
- **Android differs** (from UiAutomator's behaviour; not yet measured with these scripts): the tree
  Maestro reads on Android also lists the children of a clickable view, so an inner Text with a testID
  can appear there. The verdicts do not change: crop-only parts are filtered out by the contract on both
  platforms, and a testID still belongs on the accessible element so iOS lists it. To hide decoration
  from screen readers on both platforms, use `aria-hidden` (React Native maps it to
  `accessibilityElementsHidden` on iOS and `importantForAccessibility="no-hide-descendants"` on
  Android; verified in react-native 0.86.3 `View.js` on 2026-10-16), or set both props;
  `accessibilityElementsHidden` alone is iOS-only.
- **Speed**: about 19 s for the first iOS call (it installs the XCUITest driver), about 11 s after.
- **Environment**: Java 17 (`$JAVA_HOME`, Android Studio's bundled JBR, `/usr/libexec/java_home -v 17`)
  and analytics, notifications and update checks off; the scripts set them.
- `simctl` has no view-hierarchy command. An in-app layout reporter that writes `app.layout.json`
  (`{ "elements": [{ "testID", "x", "y", "w", "h", "text" }] }` in points, from `measureInWindow`) is
  accepted in its place (`capture-app.mjs --no-hierarchy`).

## The launch nonce

Every launch carries `nonce=<hex>`; the parity root and every modal root draw the invisible marker
`parity.launch.<nonce>`. A dump without this launch's marker is read again after 2 s (a driver can
answer once before the app's tree is attached); three dumps in a row without it stop the capture with
exit 2, "hierarchy from another device", and the last is kept as `rejected.hier.json`. `run.json`
records the device, the driver port and the nonces.

## Fast iteration after a JavaScript-only change

iOS, when native dependencies did not change (about 5 s instead of a rebuild):

1. With the variant's environment exported as for the build, `npx expo export:embed --platform ios
   --dev false --entry-file index.ts --bundle-output build/parity-bundle/main.jsbundle --assets-dest
   build/parity-bundle/assets`.
2. Copy `main.jsbundle` (and changed assets) into the built `.app`.
3. `codesign --force --sign - --deep <App>.app`, then `xcrun simctl install <udid> <App>.app`.

Android: rebuild the emulator build (android-emulator-build); a bundle swap inside a signed APK needs a
re-sign and is not worth the risk. Rebuild properly after any native change and always before the
sign-off captures.

## Human steps

- Installing Xcode and its simulator runtime, or an Android system image and its licence, needs the
  developer (`xcodebuild -downloadPlatform iOS -buildVersion 26.5`; `sdkmanager "<system image>"`); the
  setup script says so and stops.
- Installing Maestro and Java 17 follows e2e-maestro.
- An Android probe run (the type-role floors and the gate evidence on an emulator) has not been made
  yet; until it has, treat an Android-only `text-ink` centre failure near its limit as a question for
  the reviewer, never as a reason to widen anything.
