# Testing right-to-left on iOS and Android

Jest proves the decisions (the plan, the guard, digits, isolation, text direction); only screens
prove the layout. Both are required.

## Contents

- What Jest can and cannot see
- The tests to keep
- Rendering a component right to left in Jest
- iOS simulator recipes
- Android emulator recipes
- The language-switch flow (Maestro)
- Screen readers in a right-to-left layout
- The screenshot matrix and what to look for

## What Jest can and cannot see

- The React Native Jest preset reports `I18nManager.isRTL` as false and Jest computes no layout:
  nothing mirrors in Jest. So component tests set the direction explicitly (below) and assert the
  text contract: `toHaveStyle({ writingDirection: 'rtl', textAlign: TEXT_ALIGN.start })` (write
  `TEXT_ALIGN.start`, never the physical literal: `text-align-literal` applies to tests too).
- `allowRTL`/`forceRTL` reach `NativeModules.I18nManager`, which the preset mocks with `jest.fn()`:
  assert there (`direction.test.ts`), because the lint keeps the `I18nManager` import in
  `direction.ts`.
- `reloadAppAsync` calls the global `expo.reloadAppAsync`; spy on it with
  `jest.spyOn(globalThis.expo, 'reloadAppAsync').mockResolvedValue(undefined)` instead of mocking
  the `expo` package (unit-and-component-tests: SDK mocks live in root `__mocks__/`).
- Jest cannot see mirroring, clipping or font rendering: those are checked in screenshots.

## The tests to keep

| Test (template) | Asserts |
|---|---|
| `src/i18n/direction-plan.test.ts` | keep / restart / give-up for every combination |
| `src/i18n/direction.test.ts` | the layout reads LTR in Jest; allowRTL and forceRTL together; the guard is written before the single reload; no reload when the guard write fails |
| `src/i18n/direction-gate.test.tsx` | keep renders the app and clears the guard; restart shows only the restart screen and reloads once; give-up renders the app and reports once; a failed guard write gives up without reloading |
| `src/i18n/direction-restart.test.tsx` | reloads once after mounting; draws in the text locale of the target language; reports a failure instead of reloading |
| `src/i18n/direction-context.test.tsx` | the provider's value; LTR without a provider |
| `src/i18n/create-number-formatter.test.ts` | Arabic-Indic and Latin digits, percent signs with CLDR's marks |
| `src/i18n/text-direction.test.ts` | first-strong direction of Latin, Arabic, Hebrew, digit-led and isolated text |
| `src/ui/physical-direction-view.test.tsx` | `direction: 'ltr'` unless `mirrorsInRtl` |
| `src/services/direction-guard/fake-direction-guard.test.ts` | the fake's writes and failures |
| `test/direction-guard/kv-direction-guard-adapter.test.ts` | the pending marker on kv-store's real SQL over `node:sqlite`: fresh install, write, survive a simulated JS reload (`jest.isolateModules`), clear, ignore garbage |

## Rendering a component right to left in Jest

Components render through unit-and-component-tests' `renderWithProviders`, built from the app's
`test/test-app.tsx`. The canonical file already takes the two options this skill needs:

```tsx
// test/test-app.tsx (excerpt of the canonical file)
export type TestAppOptions = {
  readonly language?: Language; // default SOURCE_LANGUAGE: catalog, locale tag, text locale
  readonly direction?: Direction; // the layout direction DirectionGate provides; default directionOf(language)
  // ...
};
// inside Providers, in the root layout's order (the gate outermost):
<DirectionProvider direction={layoutDirection}>
  ...
  <TextLocaleProvider value={textLocale}>{children}</TextLocaleProvider>
</DirectionProvider>
```

`{ language: 'ar', direction: 'ltr' }` renders the run between a language change and the restart.
An app whose `test/test-app.tsx` predates these options adds them the same way.

Then every new component with text or a row gets one right-to-left render:
`await renderWithProviders(<TaskRow ... />, { language: 'ar' })`, asserting at least that it renders
without a missing message, plus a style assertion where the direction is the contract
(`// allow-style-assertion: <why>` outside the design-system folders). examples/mirrored-row.md
shows one.

## iOS simulator recipes

Name the device; never `booted`. Create one for the purpose if none exists:
`xcrun simctl create tasks-rtl "iPhone 16 Pro"` prints its UDID.

| Purpose | Command |
|---|---|
| Launch in Arabic (the "follow the device" path) | `xcrun simctl launch <udid> <bundle-id> -AppleLanguages "(ar)" -AppleLocale ar_EG` |
| Back to English | `xcrun simctl launch <udid> <bundle-id> -AppleLanguages "(en)" -AppleLocale en_US` |
| Screenshot | `xcrun simctl status_bar <udid> override --time 9:41`, then `xcrun simctl io <udid> screenshot rtl-home.png` |
| 200 % text | `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large` (reset with `large`) |
| Logs | `xcrun simctl spawn <udid> log show --last 2m --style compact --predicate 'process == "<App>"'` |

The launch arguments were verified with Xcode 26.6 on the iOS 26.5 simulator (with a Persian
locale; the arguments are the same for any language tag). They change the app's preferred language
for that launch only; the in-app choice lives in the app's settings. Use a Release build of a
development or preview variant for layout checks.

## Android emulator recipes

Name the device: `adb -s <serial>` on every command (`adb devices` lists serials such as
`emulator-5556`); start an AVD by name (`emulator -avd tasks-rtl`). Create one with
`avdmanager create avd -n tasks-rtl -k "system-images;android-36;google_apis;arm64-v8a"` when none
exists for the purpose.

| Purpose | Command |
|---|---|
| Per-app language, Android 13+ (the system Settings path) | `adb -s <serial> shell cmd locale set-app-locales <application-id> --locales ar` |
| Read it back / clear it | `adb -s <serial> shell cmd locale get-app-locales <application-id>`; `--locales` with no value sets an empty list |
| Open the language settings | `adb -s <serial> shell am start -a android.settings.APP_LOCALE_SETTINGS -d package:<application-id>` |
| Screenshot | `adb -s <serial> exec-out screencap -p > rtl-home.png` |
| 200 % text | `adb -s <serial> shell settings put system font_scale 2.0` (reset with `1.0`) |
| Logs | `adb -s <serial> logcat -d --pid=$(adb -s <serial> shell pidof -s <application-id>)` |

The `cmd locale` syntax is from the AOSP source (`LocaleManagerShellCommand`); it needs the app's
`supportedLocales` (expo-localization writes `locales_config.xml`). Changing the per-app language
does not recreate the activity by default (expo-localization's plugin adds `locale|layoutDirection`
to `configChanges`; `allowDynamicLocaleChangesAndroid: false` makes it recreate), and in both cases
the JS run continues, so `isRTL` stays stale until the process restarts:
force-stop (`adb -s <serial> shell am force-stop <application-id>`) and relaunch before judging the
layout. Android's developer option "Force RTL layout direction" mirrors native views only; React
Native's layout ignores it (it reads its own preferences and the device locale; React Native 0.86
source). None of the Android rows were device-run for this skill; run them on the first Android
build and record what you saw.

## The language-switch flow (Maestro)

`templates/.maestro/flows/rtl/01-language-switch.yaml` (copy to `.maestro/flows/rtl/`, the folder
e2e-maestro's runner runs; fill its testIDs from the app): a clean install in English → the flow
creates one task itself (add, type its title, save; it relies on no seeded data) → Settings →
Language → the right-to-left language → Restart → the home screen comes back (one reload) → that
task's row is still there (selected by its id pattern and its title) → screenshot. The runner runs it
with the other flows; by hand, on a named device:
`tools/maestro/bin/maestro --device <udid or serial> --driver-host-port <port> test -e APP_ID=<id> .maestro/flows/rtl/01-language-switch.yaml`.
It proves one restart, no crash loop and kept data; read the screenshot for the mirrored layout.
e2e-maestro owns the flow conventions (its check-flows passes this flow) and the runner; flows that
only need the app in a right-to-left language set it with e2e-maestro's `subflows/set-language.yaml`
instead of tapping through Settings.

## Screen readers in a right-to-left layout

- VoiceOver and TalkBack read in layout order: in Arabic the first element is the one at the
  start (right) edge. A swipe right still moves to the next element on both. Check that the reading
  order matches the visual order after mirroring (a row whose children are reordered by hand breaks
  it).
- `accessibilityLanguage` on a text in another language than the UI (an autonym in a language
  list) makes VoiceOver switch voices; AppText's `language` prop sets it. Isolates and direction
  marks are not spoken.
- accessibility-as-code owns labels, roles and 200 % text.

## The screenshot matrix and what to look for

Capture every changed screen in an LTR language and in each right-to-left language, light and dark,
phone and tablet, plus 200 % text, on iOS and on Android. Compare with the approved design baseline
(design-visual-parity), and read each capture for:

- text starting at the right edge in Arabic, never left-aligned Arabic paragraphs;
- rows mirrored (first item on the right), chevrons and back arrows pointing left, play, clock and
  check icons unflipped;
- fills (progress, sliders, toggles "on") growing from the right;
- physical surfaces (maps, media scrubbers) **not** mirrored;
- the language's digits wherever a number is shown (counts, dates, charts), unless the digits
  setting says Latin;
- Latin names in place inside Arabic sentences; a Latin task title with its punctuation at its own
  end;
- no clipped marks, boxes or overlapping lines at 200 % text; nothing truncated;
- the crash screen and the restart screen in Arabic too (trigger the crash screen from a
  development build's debug menu).

Report each defect as screen, language, platform, expected, seen; turn it into a failing test or a
checker case first when it can be automated.
