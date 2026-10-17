# Visual parity and screenshot comparison

Failures while capturing the app and the design and comparing them element by element: unsettled captures, the wrong device, status bars, modal roots, scroll offsets and comparison traps. design-visual-parity owns the full procedure and its failure-message table. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `maestro --version && xcrun simctl list devicetypes && emulator -version`.

<!-- Generated from assets/known-failures/parity.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- App capture
- Design capture
- Comparison
- Process

## App capture

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `parity-capture-unstable` | A screenshot caught mid-animation, or the capture fails [unstable]: the screen never held still for 300 ms | The capture ran before the screen settled, or a loop (withRepeat, a timer, a blinking caret, a polling spinner) keeps running because it ignores reduce motion | Capture until two screenshots in a row are identical; route every loop through useReduceMotion() so the parity launch rests it (never a capture-only branch); never waive it or raise the settle time for a loop | verified |  | `design-visual-parity` |
| `parity-hierarchy-other-device` | The capture stops with "hierarchy from another device", or maestro hierarchy shows another screen or language than the one launched | Maestro reached another session's simulator or emulator: a call named no --device, or two sessions' drivers shared one port | Name the device on every call (maestro --device <id> with its own --driver-host-port, simctl by UDID, adb -s <serial>) and use your own <project>-parity device; the capture proves each dump by its launch nonce | verified |  | `design-visual-parity` |
| `parity-app-died-during-capture` | "hierarchy from another device" although your own device and port were used, and the rejected hierarchy lists only the home screen (SpringBoard, the launcher); or the device log says "RPC timeout. Apparently deadlocked" | The app was not running: it crashed or aborted after launch (on a saturated machine, for example an audio engine abort when coreaudiod times out), so the launch nonce never reached the dump | Read the rejected hierarchy first: home-screen ids mean the app died. Find the crash (iOS crash reports in DiagnosticReports, Android adb -s <serial> logcat -d -s AndroidRuntime:E ReactNativeJS:V), fix it or capture on an idle machine, then capture again with the same build | verified |  | `design-visual-parity` |
| `parity-modal-root-hides-siblings` | Every capture of a dialog frame fails screen-not-reached: the root testID (the scrim) is not on screen, although the dialog is visible | accessibilityViewIsModal sits on an inner view (the dialog card), so iOS drops its siblings and the modal root's testID from the accessibility tree that Maestro reads | Put accessibilityViewIsModal on the modal root (the Scrim; VoiceOver still stays inside the dialog) and render the launch marker as its first child (ui-component-library owns the Scrim) | verified | iOS | `design-visual-parity` |
| `parity-scroll-clamped-before-insets` | A tall screen captured at a deep scroll offset stops short: scroll-mismatch | The ScrollView laid out before the safe-area insets arrived, so iOS clamped the offset to a smaller maximum; a scroll made only in onContentSizeChange never runs again | Scroll from both onContentSizeChange and onLayout, without animation (the screen body's scrollToY fed by useFrameScrollTarget()) | verified |  | `design-visual-parity` |
| `parity-status-bar-breadcrumb` | The status bar shows a back breadcrumb ("◀ <other app>") in a screenshot | The app was opened from another app (a deep link, Settings, Safari), so iOS draws a way back to it | Terminate the other app and launch this one cleanly by bundle id on your own simulator (simctl launch <udid>); never open parity frames through a deep link on iOS | verified | iOS | `design-visual-parity` |
| `parity-status-bar-a11y-clock` | maestro hierarchy reports the real time and battery although the status bar is overridden | xcrun simctl status_bar override changes only the pixels, not the accessibility tree | Leave the status bar band (the top safe area) out of element checks; compare it on pixels only | verified | iOS | `design-visual-parity` |
| `parity-home-indicator` | The design shows a home indicator that the simulator screenshot lacks | simctl io screenshot includes the Dynamic Island but never the home indicator | Hide the home indicator in the design render; do not mask the bottom of both images | verified | iOS | `design-visual-parity` |

## Design capture

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `parity-fractional-frame` | A design reference renders a few pixels taller or wider than the device screen (1206x2625 for a 1206x2622 screen) | An element screenshot of an in-flow frame sat on a fractional CSS offset | Pin the frame at (0,0) with position: fixed and clip a page screenshot to the device size | verified |  | `design-visual-parity` |
| `parity-design-frame-size` | Every element is the same few points lower (or higher) than in the design | The design frame uses another device geometry (point size, status bar, safe-area top) than the capture device | Render the design at the capture device's geometry (its point size and safe top) and mask the top safe area | verified |  | `design-visual-parity` |

## Comparison

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `parity-global-diff-gate` | A 1 pt shift, a lighter font weight or a wrong string passes a whole-screen pixel-percentage gate; a colour change is invisible in the heatmap | Whole-screen pixel-difference and SSIM noise floors overlap real defects, and a loose colour threshold misses a changed hex | Gate per element by testID: geometry within 2 pt, exact text, fill within 3 per channel, text ink metrics, aligned crop structure; report global numbers for information only | verified |  | `design-visual-parity` |
| `parity-line-height-offset` | Text sits 1 to 2 pt lower or higher than in the design while its glyphs match | React Native places text inside its line height differently from CSS half-leading | Keep the 2 pt position tolerance for text and compare ink width and height; never move text with a transform or padding to match | verified |  | `design-visual-parity` |
| `parity-dashed-edge-structure` | check-parity fails [structure] with 1 to 2 pt blobs along a dashed border that no style change removes | React Native on iOS draws borderStyle dashed with its own dash length and phase, which no style sets, so the dashes never line up with the browser render | Record a platform waiver for that element (rule structure, this cause) in a Gate-Change commit and name it in the report; never redraw the edge or widen the tolerance. A structure failure on a solid edge is a real difference | verified | iOS | `design-visual-parity` |

## Process

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `parity-widened-tolerance` | A screen passes parity only after a tolerance was raised or a reference was rendered again | Widening a tolerance or regenerating a reference to clear a failure hides the defect | Restore the tolerance and the reference and fix the app; a real platform difference becomes a reviewed waiver | verified |  | `design-visual-parity` |
| `parity-unread-sheets` | Automated parity passed, but a person still found wrong icons, shadows, alignment or mirroring | Machines cannot judge icons, shadows, optical alignment or RTL mirroring, and the side-by-side sheets were never looked at | Look at every side-by-side sheet and record the sign-off tied to the sheet's hash | verified |  | `design-visual-parity` |
| `parity-signoff-date-utc` | A sign-off or report drafted shortly after midnight carries yesterday's date | The date came from the UTC calendar day (toISOString().slice(0, 10)) instead of the local day | Write the local calendar day (or pass the day explicitly); correct a drafted date before committing the ledger (dates-streaks-and-statistics owns the local-day rule) | verified |  | `design-visual-parity` |
