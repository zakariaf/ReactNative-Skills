# The sweep matrix and the plan

What the end-of-build sweep captures, why each axis is there, and every key of
`contracts/design-review.json`. `check-review-plan.mjs` proves the plan against the app's own facts;
this page explains the choices behind each rule.

## Contents

- The axes and why each one exists
- Cells, names and the cost of a sweep
- Screens and states: the screen contract, exclusions, open links, invariants
- Themes
- Locales and direction
- Text sizes
- Devices: roles, models, names, orientation
- Motion moments
- The build
- The on-device steps and the hardware
- Every key of the plan
- When multi-package

## The axes and why each one exists

| Axis | Values | Why it is an axis |
|---|---|---|
| screen x state | every screen and state of `contracts/screens.json` except `embedded` parts | an empty, error or offline state is its own screen to a person; untested states ship broken |
| theme | `light`, `dark` (what `userInterfaceStyle` allows) | dark mode is where hard-coded colours, shadows and images break |
| locale | one left-to-right, one right-to-left locale | right to left is where rows, icons, insets and mixed text break |
| text size | `default`, `largest` | the largest size is where text clips, overlaps or truncates |
| device | the smallest phone and a large screen per platform | the smallest screen clips first; a tablet or foldable shows stretched or lost layouts |
| reduce motion | full and reduced, on video | motion is only judgeable moving; a still cannot show a skip or an end state |

Reduce motion is not a still axis: every still is captured with motion held still (the debug link's
`motion=still`, which goes through `useReduceMotion()` and `<MotionConfig>`), so loops rest and
celebrations show their end state. Motion is judged on video per declared moment, with motion on and
reduced, per platform.

## Cells, names and the cost of a sweep

A cell is one screenshot: `<screen>.<state>--<theme>--<locale>--<text>--<device>.png`, for example
`tasks.empty--dark--ar--largest--ios-phone-small.png`. Names sort screen by screen, so a contact sheet
of a folder reads like the app. The same grammar lives in `scripts/lib/review-plan.mjs` (the checkers)
and `templates/scripts/design-review/review-cells.ts` (the app's capture runner); the self-test
compares both.

Cells = states x themes x locales x (devices for `default` + devices for `largest`). The reference
Tasks app (2 screens, 1 state each, 2 themes, 2 locales, 4 devices, `largest` on the 2 smallest
phones) has 2 x 2 x 2 x (4 + 2) = 48 cells and 8 motion videos. An app with 15 screens and 40 states
has 40 x 2 x 2 x 6 = 960 cells. `check-review-plan.mjs . --list` prints every cell before anything
is captured.

The runner this skill teaches (`examples/capture-sweep.ts`) starts one Maestro run per cell, so each
cell pays Maestro's start-up (the JVM and the driver connection). Measured on 2026-10-14 with Maestro
2.10.0 on an Android 15 emulator (`small_phone` profile): 11 to 15 s per run once the driver is
installed, about 0.3 s for the `screencap` (iOS was not timed). At about 13 s a cell, 960 cells take
about 3.5 hours one device after another. The example sweeps the devices in parallel, each its own
simulator or emulator with its own driver port, so the run takes as long as the busiest device: here
the smallest phones, with 320 cells each (`default` and `largest`), about 70 minutes. It runs
unattended, once per release. A faster runner that loops over a combination's cells inside one flow
saves most of the start-up, but must keep one capture path (the runner's screenshot), the upright
rotation of iOS landscape shots and a wait for each root testID; adapt the example only with all three.

`largest` is swept on the smallest phones by default (the `devices` list of the text size) because
that is where text runs out of room first; add the tablets when the app has dense tablet layouts.
`default` is always swept on every device.

## Screens and states

- `screens.contract` (default `contracts/screens.json`, screen-contracts owns its format): every entry
  is swept except `presentation: "embedded"` (a part drawn inside a screen, not a screen) and the
  plan's `exclude` list.
- `screens.exclude`: `{ "id", "why" }` for a screen a person never sees in a shipped build (a
  test-only debug screen). The reason has at least 20 characters. A screen excluded "for time" is
  never right: the sweep exists because nobody looks at everything otherwise.
- `screens.open`: `"<screen>.<state>"` -> how the state is opened, so anyone can re-shoot any cell:
  - a debug-link query without `lang`, `theme` or `motion` (the combination sets those):
    `"open=tasks"`, `"open=tasks&seed=empty"`. The parameters and values must exist in
    `contracts/debug-links.json` (debug-menu-and-test-hooks); until that file exists the rule prints
    one SKIP line.
  - an app path, opened as `<scheme>://<path>`: `"/tasks/42"`, `"/no-such-page"` (the not-found screen).
  A state reached only by hand (a system dialog mid-purchase) still gets an entry; open it with a path
  or a debug-link parameter the app adds, never by tapping through a flow that drifts.
- `screens.invariant`: `{ "screen", "axis", "why" }` for a screen that cannot change along an axis (a
  full-screen canvas with no text across locales). Only then may two captures that differ only on that
  axis be identical; otherwise `review-axis` treats identical pictures as an axis that was not applied.

## Themes

`check-review-plan.mjs` reads every `userInterfaceStyle` in the app config (top level, `ios`,
`android`): `automatic` means both themes, `dark` means dark, and none means light (Expo's default,
verified in the SDK 57 app config reference on 2026-10-14). The app's own theme setting stays on
"system" during the sweep (`theme=system` in the combination link) and the device appearance decides:
that is the path most people use, and it proves the app follows the system. Android needs
`expo-system-ui` for `userInterfaceStyle` to apply (Expo docs).

## Locales and direction

Sweep the source language and, when the app ships one, one right-to-left language. The checker reads
`LANGUAGES` and `RTL_LANGUAGES` from `src/i18n/languages.ts` (i18n-strings-and-catalogs owns it) and
fails a locale the app does not ship or a wrong direction. More locales are welcome (a language with
long words, such as German, finds truncation sooner), but two directions are the floor. The language
is set by the app (the debug link's `lang`, which the in-app picker also writes), not by the device
locale, because the in-app picker is the path people use and it restarts into right to left through
rtl-and-direction's guard.

## Text sizes

| id | iOS content size (`simctl ui <udid> content_size`) | React Native `fontScale` on iOS | Android `font_scale` |
|---|---|---|---|
| `default` | `large` | 1.0 | 1.0 |
| `largest` | `accessibility-extra-extra-extra-large` | 3.571 (the app's text primitive caps it at 2) | 2.0 (the largest Android 14 and later offer) |

The values are fixed by the checker: `largest` means the largest size a person can choose, never "the
largest size the layout survives". Clamping text so a layout stays tidy is an accessibility-floor
BLOCKER (accessibility-as-code owns the cap and the 200 % rule). iOS fontScale values for the content
sizes were measured on the simulator for large, accessibility-medium and AX5 (1.0, 1.786, 3.571);
Android 14 introduced non-linear font scaling up to 200 %.

## Devices

Each device is `{ id, platform, role, model, name, orientation?, size? }`.

- `role` is one of `smallest-phone`, `phone`, `tablet`, `foldable`, `desktop`. Per shipped platform
  (the config's `platforms`, else iOS and Android): a `smallest-phone`; on iOS a `tablet` when
  `ios.supportsTablet` (or `isTabletOnly`) is true, swept in landscape unless `ios.requireFullScreen`
  is true; on Android always a `tablet` or `foldable`, swept in landscape.
- iPad landscape is not optional either: with `supportsTablet: true` and no `requireFullScreen`,
  prebuild writes all four `UISupportedInterfaceOrientations~ipad` (Expo's `withRequiresFullScreen`
  plugin, read in `@expo/config-plugins` of SDK 57 on 2026-10-14; App Store validation, ITMS-90474,
  demands them for multitasking). So `orientation: 'portrait'` locks phones only: iPads rotate, split
  the screen, and from iPadOS 26 resize their windows freely. Sweeping the iPad in landscape covers the
  layout a phone-first app has never shown; a second iPad device in portrait is welcome. Apple
  deprecated `UIRequiresFullScreen` in iPadOS 26 (TN3192), so `requireFullScreen` is only a
  short-lived reason to skip landscape; adaptive-layout owns the layout rules.
- Android landscape is not optional: for apps targeting API 36 (Expo SDK 57), Android 16 ignores
  `screenOrientation`, `resizableActivity` and the aspect-ratio limits on displays 600 dp and wider
  (games excepted; Android 16 behaviour changes, read 2026-10-14). A portrait-locked app therefore runs
  in landscape on every Android tablet, and the sweep must show it. The one opt-out, the manifest
  property `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`, works only while the app
  targets API 36 and stops working at API 37, so the plan still requires the landscape tablet: the
  layout is needed by the next target bump anyway (verified on 2026-10-14 in Android 16's behaviour
  changes for apps targeting 16; re-verify at
  https://developer.android.com/about/versions/16/behavior-changes-16).
- An app config `orientation` of `default` (no lock) needs at least one landscape device; `landscape`
  needs every phone in landscape. How to turn each device (Maestro's `setOrientation` on iOS, Android's
  `user_rotation`) and why iOS landscape shots are turned upright afterwards: capture-recipes.md.
- `name` is the simulator or emulator this review creates and owns, `<project>-<purpose>` (never
  `booted`, never a shared one). Two devices never share a name: one device holds one appearance and
  one text size at a time.
- `size` (optional) is the capture size in pixels; with it, `review-capture` fails a capture of another
  size. Without it, every capture of one device must at least have the same size. An iPhone SE
  (3rd generation) simulator captures 750 x 1334 (`simctl io screenshot`, verified 2026-10-14).

Models that exist on this machine's runtimes (verified 2026-10-14 with `xcrun simctl list runtimes -j`
on Xcode 26.6 / iOS 26.5, and `avdmanager list device` from the Android command-line tools):

| Role | iOS | Android (AVD hardware profile) |
|---|---|---|
| smallest-phone | iPhone SE (3rd generation): 375 x 667 pt, the shortest screen iOS 26 supports | `small_phone`: 720 x 1280 px, xhdpi, 360 x 640 dp |
| phone | iPhone 17 | `medium_phone`: 1080 x 2400 px, 420 dpi |
| tablet | iPad mini (A17 Pro): 744 pt wide, the narrowest regular-width iPad | `medium_tablet`: 2560 x 1600 px (landscape natural) or `pixel_tablet` |
| foldable | - | `pixel_fold` |

Re-verify: `xcrun simctl list runtimes -j` (each runtime's `supportedDeviceTypes`) and
`avdmanager list device -c`.

## Motion moments

`motion.catalog` (default `src/ui/motion/motion-moments.ts`, motion-and-animation owns it) declares
every moment that moves. Every moment is in `motion.record` (a video per platform, motion full and
reduced) or in `motion.notRecorded` with why (at least 20 characters: "the press videos show the
release"). A moment the catalog adds later fails the plan until it is placed. When the catalog does not
exist yet the rule prints one SKIP line.

## The build

`build.variant` is `preview`, the only value the plan accepts: a Release build (the same JavaScript
and optimizations the store build ships), never the development client (debug overlays, slow
JavaScript, a different bundle). The capture needs the test-only debug link on every combination, not
only for states opened by a query: `debug/setup?lang=<locale>&theme=system&motion=still` sets the
in-app language, puts the app theme on the system appearance and holds animations still
(capture-recipes.md, "One combination"). So `contracts/debug-links.json` must declare `lang` with
every plan locale, `theme` with `system` and `motion` with `still` (`plan-open`), and production,
which strips the link, is refused (`plan-build`).

There is no production lane for the sweep, on purpose: without the link, the language would come from
the device or per-app locale and motion from the system setting, per device and per combination, a
second capture path whose cells differ from the preview path's for reasons that are not the app. What
only the store build can show (signing, the stripped debug code, store-delivered assets, real
upgrades) is judged on TestFlight and Play internal builds in the on-device pass (device-pass.md).

## The on-device steps and the hardware

`devicePass.hardware` lists the real phones, at least one per shipped native platform: the cheapest
phone of the target market, never only a flagship and never a device farm alone (both hide the budget
hardware and real-state bugs). `devicePass.steps` keeps every core step, non-destructive first:

| Step | Destructive | A failure is always a BLOCKER |
|---|---|---|
| `real-state` | no | no |
| `screen-reader` | no | yes |
| `switch-access` | no | yes |
| `largest-text` | no | yes |
| `reduce-motion` | no | yes |
| `audio-haptics` | no | no |
| `interruptions` | no | no |
| `upgrade-in-place` | yes | yes |
| `backup-restore` | yes | yes |
| `crash-log` | yes | yes |
| `fresh-install` | yes | yes |

An app adds its own steps (a purchase restore, a widget) anywhere before the destructive ones. A step
that does not apply stays in the plan and is answered `n/a` with its reason in the record.
[device-pass.md](device-pass.md) says what each step does.

## Every key of the plan

| Key | Default | Read by |
|---|---|---|
| `version` | must be 1 | all scripts |
| `reviewsDir` | `design-review` (committed records) | new-review, check-review, check-signoff |
| `capturesDir` | `reports/design-review` (git-ignored captures) | new-review, check-review |
| `screens.contract`, `.exclude`, `.open`, `.invariant` | `contracts/screens.json`, `[]`, required, `[]` | all |
| `themes`, `locales`, `textSizes`, `devices` | required | all |
| `motion.catalog`, `.record`, `.notRecorded` | `src/ui/motion/motion-moments.ts`, `[]`, `[]` | plan, new-review, check-review |
| `build.variant` | required, `preview` | plan, check-review, check-signoff |
| `signoff.watch`, `.ignore` | `[]`, `[]`: extra user-facing path globs, and watched paths that never change what people see | check-signoff |
| `devicePass.hardware`, `.steps` | required | all |

The plan's own folder is `contractsDir` from `rn-skills.config.json` (default `contracts/`), and
languages come from `<i18nDir>/languages.ts`; both through check-lib's `resolveLayout()`. Every script
also takes `--plan <file>`.

## When multi-package

Each app has its own plan, records and captures: run every script with the app folder as the
repo-root argument (`node check-review-plan.mjs apps/mobile`). The app's `rn-skills.config.json` (or
its tsconfig paths) gives its folders. A shared design system does not share a review: each app ships
alone and is signed off alone.
