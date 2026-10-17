# Performance and accessibility

Measurement traps, budgets, and accessibility findings on VoiceOver and TalkBack. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm run -s check:fast`.

<!-- Generated from assets/known-failures/perf.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Cold start
- Budgets
- Accessibility
- Rendering

## Cold start

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `perf-js-cold-start` | A JS-only cold-start timing looks fast but launch feels slow | JS timing misses most of the launch (process start, native init, bundle load) | Measure from process start to the first frame (a native process-start timestamp), over many launches | verified |  | `performance-budgets` |
| `perf-cold-start-old-launches` | The perf report check fails on cold starts recorded by an older build | The perf log survives app updates, so earlier builds were mixed in | Judge only the latest launches of the current build (the checker drops older entries) | verified |  | `performance-budgets` |
| `perf-polyfill-cold-start` | Cold start over budget on an older phone | The forced Intl polyfills and their locale data cost time and bundle size | Measure on a device before changing the polyfill policy; load only the locales the app ships | open |  | `performance-budgets` |

## Budgets

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `perf-budgets-without-device` | A budget fails on a real device that passed on the simulator or emulator | Bundle, memory and draw budgets were first estimates from simulator probes | Re-baseline from device runs with a Gate-Change trailer; never loosen a budget to pass one run | open |  | `performance-budgets` |

## Accessibility

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `perf-text-scale-values` | Large-text screenshots look unscaled | Each content-size category maps to a font scale (large 1.0, accessibility-medium 1.786, accessibility-extra-extra-extra-large 3.571) | iOS: xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large; Android: adb -s <serial> shell settings put system font_scale 2.0; cap with maxFontSizeMultiplier where the design needs it | verified |  | `accessibility-as-code` |
| `perf-adjustable-no-actions` | VoiceOver swipe up or down (or the TalkBack adjust gesture) does nothing on a slider | accessibilityRole 'adjustable' without accessibilityActions increment and decrement | Add both actions and onAccessibilityAction; the a11y checker requires them | documented |  | `accessibility-as-code` |
| `perf-reduce-motion-springs` | Reduce Motion is on, but presses still sink and spring | No root motion config applies the reduce-motion setting to Reanimated's layout and spring animations | Wrap the app root in the motion config fed by useReduceMotion | documented |  | `motion-and-animation` |
| `perf-smart-invert` | Smart Invert changes the colours of a canvas or photo | The view is inverted like other content | Set accessibilityIgnoresInvertColors on canvases and images (the palette has a dark variant) | documented | iOS | `accessibility-as-code` |
| `perf-hit-region-size` | Canvas cells or small controls are below 44 pt (48 dp on Android) and nothing fails | The layout does not expose the smallest hit region | Expose the hit size from the layout and assert at least 44 pt / 48 dp in tests | open |  | `canvas-gestures-and-hit-testing` |
| `perf-contrast-state-fill` | Text contrast drops below 4.5:1 during a pressed or held state | The state fill was never listed as a contrast pair | List every text-on-fill pair (states included) in contracts/contrast.json and fix the token, never the threshold | verified |  | `accessibility-as-code` |
| `perf-modal-android-background` | TalkBack still reaches the screen behind a custom modal or dialog, while VoiceOver stays inside it | accessibilityViewIsModal is iOS-only | On Android hide the content behind the dialog with importantForAccessibility='no-hide-descendants' while it is open (the shared dialog root does both) | documented | Android | `accessibility-as-code` |

## Rendering

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `perf-box-shadow-device` | boxShadow or outline looks different on a device | Not verified on every platform version | Check in the first device build of each platform; keep a fallback shadow view | open |  | `design-system-structure` |
