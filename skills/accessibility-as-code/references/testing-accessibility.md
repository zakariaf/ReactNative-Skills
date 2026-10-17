# Testing accessibility

Automated checks catch missing roles, names, sizes and contrast; screenshots at the largest text
size catch clipping; only a person with VoiceOver and TalkBack can judge whether the spoken output
makes sense. All three are required.

## Contents

- Component and screen tests (React Native Testing Library)
- The tests to keep
- Large text on a simulator and an emulator (Maestro)
- Tools that help a human
- The screen-reader pass on a release candidate
- Turning a report into a test

## Component and screen tests (React Native Testing Library)

- Query by **role and name** first: `screen.getByRole('button', { name: 'Add task' })`,
  `getByRole('header', { name: 'Today' })`, `getByRole('checkbox', { name: 'Buy milk' })`. A missing
  role or name then fails the test, not a user. Names are the real catalog text of the test locale,
  because `renderWithProviders` (unit-and-component-tests) renders with the app's providers.
- Assert state with `toBeDisabled()`, `toBeBusy()`, `toBeChecked()`, `toBeSelected()` and
  `toHaveAccessibleName()`. RNTL 14 has no hint matcher: use
  `toHaveProp('accessibilityHint', '…')`.
- End **every screen test** with the audit:

```tsx
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';

expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
```

It walks the rendered host tree, finds every element with a press handler, and returns one message
per missing role or accessible name (a label, or visible text inside), for example
`tasks.add-button: no role`. A pressable hidden from screen readers (`accessible={false}`, `aria-hidden`:
a backdrop, a keyboard-dismiss area) is skipped; its action must be reachable another way. It returns a list instead of calling `expect` because it is a helper, not
a test. `check-a11y-code` fails `screen-test-audit` for a screen test (`*-screen.test.tsx`, or a
test under `screens/`) that renders without it.

- The touch box is one of the few style assertions a test may make:
  `expect(screen.getByRole('button', { name: 'Settings' })).toHaveStyle({ width: 44, height: 44 })`.
- Reduce motion in a test: wrap the subject in `<MotionConfig preference="on">`, or set
  `systemA11yStore.setState({ isReduceMotionOn: true })` inside `act()`, then assert the reduced
  path (no scale animation started, the toast fades). Reset the store in `beforeEach`, never in
  `afterEach`: RNTL unmounts in its own `afterEach`, which runs after the block's, so a reset there
  updates a mounted tree outside `act()` and prints "not wrapped in act(...)".

## The tests to keep

| Test (template) | Asserts |
|---|---|
| `test/a11y/app-contrast.test.ts` | every colour table in the contrast contract (the theme palette first) meets AA in every set at the gates' thresholds; every `distinct` list passes the colour-blind check |
| `test/a11y/contrast-contract.test.ts` | the helpers: unknown keys refused, thresholds raised by the gates, the contract path from `rn-skills.config.json`, faint text, a shape with neither edge nor ground, an exception, compositing, Okabe-Ito vs red/green |
| `test/a11y/find-inaccessible-pressables.test.tsx` | a roleless and a nameless pressable are reported; hidden and named ones pass |
| `src/ui/a11y/*.test.ts(x)` | the store follows each OS switch (reduce motion, screen reader, Bold Text), a change event beats a slower first read, and nothing is written after stop; announcements only while a screen reader runs, queued; the preference against the phone; Reanimated's global mode |
| each screen's test | role and name queries, and the audit line |
| each custom canvas's `describe()` test | the summary sentence for typical states |

## Large text on a simulator and an emulator (Maestro)

The `a11y`-tagged flows (`templates/.maestro/flows/a11y/01-large-text-core-screens.yaml`, copied to
`.maestro/flows/a11y/`, the folder e2e-maestro's runner runs at the largest size once per
`contracts/e2e.json` `largeText` locale) visit the core screens at the largest text size and take
screenshots. Each pass sets its language first (e2e-maestro's `subflows/set-language.yaml` reads
`LANG`) and opens the home screen through the debug link, so e2e-maestro's check-flows passes it
(`large-text-lang`, `debug-open`). They also
open a task by tapping its card by the opener's `testID`: Maestro taps the centre of the opener's
bounds on the real screen, where the card's text layer sits, so the step fails when that layer takes
the touch instead of passing it to the opener, which no RNTL test can see. Run them
on devices you name, never on "the booted one": several sessions share a machine, and an unnamed
command can reach another session's device. Create your own when needed
(`<project>-a11y-phone`, `<project>-a11y-tablet`); e2e-maestro owns the runner.

Both platforms take `--device` and `--driver-host-port` before the command. The driver port is not
iOS only: Maestro 2.10.0 forwards a host port to the on-device driver on Android too, and falls back
to one fixed default port on both platforms when the flag is missing, so two runs at once on
different devices compete for the same port (`MaestroSessionManager.kt` and `AndroidDriver.kt`, read at
tag v2.10.0 on 2026-10-03; re-verify:
`curl -sL https://raw.githubusercontent.com/mobile-dev-inc/maestro/v2.10.0/maestro-cli/src/main/java/maestro/cli/session/MaestroSessionManager.kt | grep -n "driverHostPort ?:"`,
which prints the iOS `defaultXcTestPort` and Android `DEFAULT_DRIVER_HOST_PORT` fallbacks). Pick a
free port per run:

```sh
PORT="$(node -e "const s=require('node:net').createServer().listen(0,()=>{console.log(s.address().port);s.close();})")"
```

iOS (verified with Maestro 2.10.0 and an iOS 26.5 simulator at the largest size: `launchApp`,
`assertVisible` and `tapOn` by `id`, `takeScreenshot`):

```sh
# UDID: your own simulator; PORT: a free local port for this run's Maestro driver (above).
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
maestro --device "$UDID" --driver-host-port "$PORT" test .maestro/flows/a11y --include-tags a11y \
  -e APP_ID="$APP_ID" -e APP_SCHEME="$APP_SCHEME" -e LANG=en --format JUNIT --output reports/a11y/ios.xml --test-output-dir reports/a11y/ios
xcrun simctl ui "$UDID" content_size large
```

Android (the font-scale command is from Android's `settings` documentation; this lane was not run
by this skill; use your own emulator, named by its serial):

```sh
# SERIAL: your own emulator, for example emulator-5556 for the AVD <project>-a11y-phone; PORT as above.
adb -s "$SERIAL" shell settings put system font_scale 2.0
maestro --device "$SERIAL" --driver-host-port "$PORT" test .maestro/flows/a11y --include-tags a11y \
  -e APP_ID="$APP_ID" -e APP_SCHEME="$APP_SCHEME" -e LANG=en --format JUNIT --output reports/a11y/android.xml --test-output-dir reports/a11y/android
adb -s "$SERIAL" shell settings put system font_scale 1.0
```

Run each pass in one left-to-right locale and, when the app ships one, one right-to-left locale (`-e LANG=<locale>`).
Read every screenshot (the Read tool) for clipped glyphs, overlapping or truncated text, and rows
that should have stacked; design-review-workflow repeats the sweep across themes and devices.

## Tools that help a human

- **Xcode Accessibility Inspector** (Xcode > Open Developer Tool) points at a simulator element and
  shows its label, role, value and frame; its audit flags small targets, missing labels and
  clipped Dynamic Type.
- **Android Accessibility Scanner** (Google Play) scans the screen on a device and suggests fixes
  for touch targets, contrast and labels. TalkBack's developer settings can show speech output as
  on-screen text.
Both are aids for the human pass, never evidence on their own.

## The screen-reader pass on a release candidate

A human step, once per release candidate, on the TestFlight build (iOS) and the Play internal
testing build (Android), in one left-to-right locale and, when shipped, one right-to-left locale
(about 15 minutes per platform). Tell the developer when the builds are ready; never claim it
passed without their report.

Setup, once. iOS: Settings > Accessibility > Accessibility Shortcut > VoiceOver, then a
triple-click of the side button toggles it. Android: Settings > Accessibility > TalkBack >
TalkBack shortcut, then holding both volume keys toggles it (Google's TalkBack help, 2026-10-03;
menus vary by device maker).

Gestures. VoiceOver: swipe right/left = next/previous, double-tap = activate, swipe up/down on an
adjustable = change it, two-finger swipe up = read all, two-finger scrub ("Z") = back. TalkBack:
swipe right/left = next/previous, double-tap = activate, double-tap and hold = long press, volume
keys on a slider = change it, the back gesture or swipe down then left = back (check against the
device's TalkBack version).

1. **Launch.** The first thing read is the screen's title. No element is read as just "button".
2. **Language picker (if any):** each language name is spoken in its own language on iOS.
3. **Main list:** swiping visits elements in visual order (in a right-to-left locale, from the top
   right). A task reads its title, due date and state ("Buy milk, due tomorrow, not checked").
4. **Card with an action:** the card body and its action are two stops, each with its own name.
   Without a screen reader, tapping the card's title text opens it.
5. **Custom canvas (chart):** it reads one summary sentence, updated after a change.
6. **Dialogs and sheets:** while open, neither screen reader reaches anything behind them, the
   header's back button and the tab bar included; the escape gesture or back closes them. A
   backdrop that is hidden from the screen reader has its action on a reachable Close button too.
7. **Settings:** switches say on/off; a slider changes with swipe up/down (VoiceOver) or the volume
   keys (TalkBack); a hold-to-confirm action can be confirmed without holding.
8. **Swipe, drag and long-press actions:** every action a row reveals by swiping (complete,
   delete), reorders by dragging or opens by a long press is in the VoiceOver Actions rotor and the
   TalkBack menu's custom actions, with a spoken name, and also reachable with one tap.
9. **Purchases (if any):** the price is read in the local currency; "busy" is announced while a
   purchase is in progress.
10. **After an action:** one short announcement (or live-region update) is heard, not several, and
    not cut off by the next screen; a toast with an action (Undo) stays until it is dismissed.

## Turning a report into a test

Each problem is reported as: platform, screen, locale, what was expected, what was heard. Turn
each into a failing RNTL or Maestro test first (red), then fix it (green), and report back with
the test name as evidence. A problem a machine cannot see (an unclear sentence) becomes a catalog
change with the reviewer's sign-off.
