# Text scaling and reduce motion

How iOS and Android send the user's text size, what the app's text primitive does with it, the
layout rules that keep 200 % text readable, and the one source of truth for reduce motion with the
reduced alternative of each kind of movement.

## Contents

- What iOS sends (Dynamic Type)
- What Android sends (font scale)
- The cap and the text primitive
- Layout rules at large text
- Tall glyphs and clipping
- Bold Text (iOS only)
- Reduce motion: one source of truth
- Moments and their reduced alternatives
- Screenshots with motion held still

## What iOS sends (Dynamic Type)

React Native's `fontScale` per content-size category, from `RCTAccessibilityManager.mm` in React
Native 0.86.3 (verified by reading the source on 2026-10-03; re-verify:
`grep -n "UIContentSizeCategory.*@" node_modules/react-native/React/CoreModules/RCTAccessibilityManager.mm`):

| `xcrun simctl ui <udid> content_size …` | `fontScale` | Body 17 pt becomes (with a 2× cap) |
|---|---|---|
| `extra-small` · `small` · `medium` | 0.823 · 0.882 · 0.941 | 14 · 15 · 16 |
| `large` (default) | 1.0 | 17 |
| `extra-large` · `extra-extra-large` | 1.118 · 1.235 | 19 · 21 |
| `extra-extra-extra-large` | 1.353 | 23 |
| `accessibility-medium` | 1.786 | 30.4 |
| `accessibility-large` | 2.143 | 34 (cap) |
| `accessibility-extra-large` · `-extra-extra-large` | 2.643 · 3.143 | 34 (cap) |
| `accessibility-extra-extra-extra-large` | 3.571 | 34 (cap) |

## What Android sends (font scale)

Android's font size setting writes `font_scale` (Settings > Display > Font size; Android 14 and
newer offer steps up to 2.0, from the Android 14 release notes). `useWindowDimensions().fontScale`
returns the raw setting. React Native 0.86.3 converts text sizes with
`TypedValue.applyDimension(COMPLEX_UNIT_SP, …)` (`PixelUtil.kt`, read on 2026-10-03; re-verify:
`grep -n "applyDimension\|maxFontScale" node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/PixelUtil.kt`),
so on Android 14+ the system's non-linear curve applies: small text grows by the full factor, large
text grows less (re-verify: "Non-linear font scaling to 200%" in
https://developer.android.com/about/versions/14/features). A layout that survives the iOS
accessibility sizes usually survives Android at 2.0, but test both. Set it on a named emulator with `adb -s <serial> shell settings put system font_scale 2.0`
and restore `1.0` afterwards (from Android's `settings` documentation; not exercised by this skill's
checkers).

## The cap and the text primitive

- Text must grow to at least **200 %** (WCAG 1.4.4). The app's one text primitive (`AppText` in
  `src/ui/app-text.tsx`, design-system-structure) may cap growth with `maxFontSizeMultiplier`, and
  the cap is never below 2 (`a11y.maxFontScale`, default 2). On Android the cap is applied in
  `PixelUtil.toPixelFromSP` as `min(scaled, size * density * cap)` (the `PixelUtil.kt` grep in the
  section above), on iOS in the text layout; the 2× cap held text at 2× in a screenshot at the
  largest iOS size.
- Never `allowFontScaling={false}`, never a lower `maxFontSizeMultiplier` on one screen, never a raw
  font size outside the type roles. A short label in a cramped bar can show iOS's large content
  viewer (`accessibilityShowsLargeContentViewer`) instead of capping text.

## Layout rules at large text

- `minHeight`, not `height`, on every container of text; tiles and buttons that hold text grow
  with the font and keep at least the minimum touch width.
- No `numberOfLines` on sentences: text wraps, never truncates. A one-line title may use
  `numberOfLines` only when the full text is reachable (a detail screen, the accessibility label).
- Rows stack when the text is large: `fontScale >= 1.25` turns horizontal rows into vertical
  ones, values drop under their labels, and two-button rows become two full-width buttons. Read
  `fontScale` from `useWindowDimensions()`, never from a one-time read. Why 1.25: it sits between
  iOS "Extra Extra Large" (1.235) and "Extra Extra Extra Large" (1.353), and below Android's 1.3
  step (Android 14 and newer offer 0.85, 1.0, 1.15, 1.3, 1.5, 1.8 and 2.0). A threshold of exactly 1.3
  would miss Android's 1.3 step: React Native 0.86.3 reads `Configuration.fontScale`, a 32-bit
  float, and widens it to a double, so JavaScript sees 1.2999999523162842 (`DeviceInfoModule.kt`,
  read on 2026-10-03; re-verify:
  `grep -n fontScale node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/deviceinfo/DeviceInfoModule.kt`,
  which shows `fontScale: Float` and `putDouble("fontScale", fontScale.toDouble())`). Never compare
  a font scale against one of Android's own steps.
- Test layout functions at the smallest and largest supported widths (320 and 1376 pt) and at
  `fontScale` 2.

## Tall glyphs and clipping

iOS clips glyphs at the text line box, where a browser (and most design tools) let them overflow.
Scripts with tall marks or digits (Arabic and Persian digits, Thai, Devanagari, Vietnamese stacked
diacritics) lost the tops of their glyphs at line height 1.0 in a shipped app. Give those locales'
type roles a taller line height (about 1.4 to 1.5), keep only minimum heights around the text,
and in screenshots of those locales look at the tops and bottoms of glyphs, not only at wrapping.
On Android, keep `includeFontPadding` at its default unless the type roles compensate for it. A
clipped glyph is a defect, never a waiver.

## Bold Text (iOS only)

iOS Settings > Accessibility > Display & Text Size > Bold Text asks every app for heavier text.
React Native 0.86.3 exposes it as `AccessibilityInfo.isBoldTextEnabled()` and the `boldTextChanged`
event, both iOS only: on Android the call resolves `false` (`AccessibilityInfo.js`, read on
2026-10-03; re-verify:
`grep -n "boldText\|BoldText" node_modules/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js`).
Text in a custom font loaded with expo-font keeps the weights of its font files, so it does not
get heavier on its own (from how font files work; not exercised on a device by this skill).

`systemA11yStore` mirrors it as `isBoldTextOn` through its one subscription (`watchSystemA11y`
reads `isBoldTextEnabled()` once and listens to `boldTextChanged`; always `false` on Android). An app
that ships custom fonts reads it in one place, never in a screen: its text primitive. The app adds
the step there: while `useStore(systemA11yStore, (state) => state.isBoldTextOn)` is true, the
primitive moves each type role one weight step heavier (regular to semibold, semibold to bold). The
canonical `AppText` from design-system-structure does not read the switch, so the step is the app's
own change to its copy until that skill adopts it.
`check-a11y-code` fails `a11y-store` for a screen that reads `isBoldTextEnabled()` itself. Android 12 and newer have their own
bold text setting (`Configuration.fontWeightAdjustment`), which React Native 0.86.3 does not read
(no match in its Android sources on 2026-10-03; re-verify:
`grep -rln fontWeightAdjustment node_modules/react-native/ReactAndroid/src/main/`), so it is not
covered on Android.

## Reduce motion: one source of truth

- `useReduceMotion()` (`src/ui/a11y/use-reduce-motion.ts`) resolves the in-app preference
  (`system` / `on` / `off`, from `<MotionConfig preference={…}>`) against the phone's switch in
  `systemA11yStore`. `resolveReduceMotion(preference, isSystemOn)` is pure and tested. An app
  without a "Reduce motion" setting passes `preference="system"`.
- The phone's switch: iOS Settings > Accessibility > Motion > Reduce Motion; Android "Remove
  animations", which React Native 0.86.3 reads as `Settings.Global.TRANSITION_ANIMATION_SCALE == 0`
  (`AccessibilityInfoModule.kt`, read on 2026-10-03; turning animations off in developer options
  counts too; re-verify:
  `grep -n TRANSITION_ANIMATION_SCALE node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/accessibilityinfo/AccessibilityInfoModule.kt`).
- `watchSystemA11y` subscribes to each switch before reading it once, lets a change event win over
  a slower first read, and writes nothing after its stop function ran (async-safety rule 4).
- Never use Reanimated's `useReducedMotion()`: in 4.5.1 it returns `IS_REDUCED_MOTION_ENABLED_IN_SYSTEM`,
  a value captured when the module loaded (`src/hook/useReducedMotion.ts`, read on 2026-10-03;
  re-verify: `grep -n IS_REDUCED_MOTION node_modules/react-native-reanimated/src/hook/useReducedMotion.ts`),
  so it misses live changes and the in-app setting. Never read `AccessibilityInfo` outside the store
  (`check-a11y-code`: `reduce-motion` for Reanimated's hook, `a11y-store` for any switch read).
- `<MotionConfig>` at the root also sets Reanimated's global `ReducedMotionConfig`
  (`ReduceMotion.Always` / `Never`), so every `withTiming`, `withSpring` and layout animation that
  keeps the default `reduceMotion: ReduceMotion.System` follows both. In development builds
  Reanimated logs "Reduced motion setting is overwritten with mode …", which is expected.
- Functional timers (a hold-to-confirm fill, a countdown the user acts on) pass
  `reduceMotion: ReduceMotion.Never`: a safety hold must not finish instantly.
- Canvas animations (Skia timelines) do not go through Reanimated's config: they read
  `useReduceMotion()` and build their reduced timeline (skia-canvas-rendering).
- What `<MotionConfig>` does not reach (verified in source on 2026-10-10 in the harness's
  `node_modules`): Reanimated 4.5.1 CSS animations and transitions (`src/css/` never reads the
  reduce-motion manager) and react-native-screens 4.26.2 native stack transitions (`src/` has no
  reduce-motion read). Each needs its reduced form chosen in code: motion-and-animation's
  `useScreenAnimation()` gives every native `<Stack>` its `animation` (a fade or `'none'` when
  reduced), and its `css-motion-reduced` rule covers CSS animations. Re-verify:
  `grep -rliE 'reduced?motion' node_modules/react-native-reanimated/src/css node_modules/react-native-screens/src`
  (no output means neither reads it).
- Reanimated decides reduce motion once per animation, when it starts
  (`animation.reduceMotion = getReduceMotionFromConfig()` in `src/animation/util.ts`), so a
  running loop keeps moving after the switch flips on. Loops go through motion-and-animation's
  `useMotionLoop`, which cancels a running loop when motion becomes reduced.
- Anything that reads `useReduceMotion()` renders below `<MotionConfig>`, never in the component
  that mounts it (that read sees no preference). motion-and-animation's `check-motion` proves the
  root mounts `<MotionConfig>` and starts `watchSystemA11y` (`reduce-motion-root`) and flags a
  component that mounts the provider and reads the answer itself.

## Moments and their reduced alternatives

Every moment that moves declares its reduced alternative (motion-and-animation keeps the app's
moment catalog and timings):

| Kind of moment | Normal | Reduce motion |
|---|---|---|
| Press feedback: sink and squash | short ease-out | no squash, no scale; an instant colour or opacity change is fine |
| Release: spring back | spring with overshoot | instant return |
| Colour and fill changes | short timing | instant |
| Toggle knob | slide with overshoot | instant |
| Celebrations (pops, slaps, confetti, stars appearing one by one) | staggered scale and bounce | everything shown at once with one short fade, or nothing |
| Toasts, banners, sheets | slide in | short fade |
| Screen push | slide in the reading direction | cross-fade or none |
| Loops (pulsing badge, bobbing hint, busy animation) | loop | static, plus a busy text or icon |
| Parallax, zoom, shake | — | removed |
| Functional timers (hold to confirm, countdown) | linear progress | unchanged (`ReduceMotion.Never`) |

Spring configs write `mass` out. Reanimated 4.5.1's `withSpring` default is its "gentle" config
(`damping: 120, stiffness: 900, mass: 4`, `springConfigs.ts`, read on 2026-10-03; re-verify:
`grep -n -A4 GentleSpringConfig node_modules/react-native-reanimated/src/animation/spring/springConfigs.ts`),
so a config that sets only damping and stiffness inherits `mass: 4`: a release twice as slow and
much bouncier than designed.

## Screenshots with motion held still

Screenshot and visual-comparison runs need animations at rest. Do not add a second reduce-motion
hook for it: the test-only setup (debug-menu-and-test-hooks) passes `preference="on"` to
`<MotionConfig>` for that launch, and every animation, including Reanimated's global config, holds
still through the same path users take.

- What a Settings row shows stays apart from what animations read. A "Reduce motion" row shows
  `resolveReduceMotion(savedPreference, isSystemOn)`, with the saved preference from the settings
  store (settings-and-preferences) and `isSystemOn` from
  `useStore(systemA11yStore, (state) => state.isReduceMotionOn)`, never
  `useReduceMotion()`: the hook reads `<MotionConfig>`, so in a screenshot run it returns the forced
  `"on"`, and every capture of the Settings screen would show a value production never shows.
