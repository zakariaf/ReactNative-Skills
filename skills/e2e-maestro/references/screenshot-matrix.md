# The screenshot matrix

Every screen the matrix flow opens, in each locale of the contract, light and dark, on the phone and
the tablet, per platform; compared with committed baselines and shown to the reviewer in one gallery.

## Contents

- What is captured
- A still, deterministic screen
- Running it
- Baselines
- Reviewing: open every changed PNG
- The gallery
- The largest text size
- Screenshots and the approved design

## What is captured

`contracts/e2e.json` `screenshots`: `locales` (include one right-to-left locale when the app has
one), `devices` (phone and tablet by default), and the platforms whose baselines `--baselines`
requires (both by default). `.maestro/screenshots/matrix.yaml` clears state and sets the app up in two
links, then runs `shoot-screen.yaml` once per screen with `SCREEN` (the debug link's `open` value,
which names the PNG) and `ROOT` (the testID that proves the screen is shown). Screens that need data
get it from the app's own fixtures through the link; add one `runFlow` per screen.

1. **The language alone**, through `subflows/set-language.yaml`: `lang=${LANG}` as the link that
   launches the app (`stopApp`, then `openLink`). A language that flips the layout direction (en to
   ar) restarts the JS runtime and nothing after `lang=` runs; after the restart the app opens its
   launch link again, applies it without a flip and ends on the debug menu (debug-menu-and-test-hooks'
   link semantics). The sub-flow waits for `debug.menu`, so it returns only once the restart is over.
   One link with `lang=` and everything else would lose the rest in the right-to-left locale, and a
   wait for the landing screen would pass before the restart and race it.
2. **Everything else**: `theme=system&motion=still&date=<fixed day>&offline=1&open=<home>`, waiting
   for the home screen's root, which proves this link arrived (the app was on the debug menu).

`check-flows` rule `debug-lang-alone` fails a setup link that sets a right-to-left `lang=` (or
`lang=${LANG}` when the contract lists a right-to-left locale) together with other parameters.
Not yet run on a device: the reference app gets the debug link in the same wave as this split. The
first right-to-left capture confirms the restart and the re-delivered launch link on both platforms;
if a platform ever stops re-delivering it, `set-language.yaml` times out on `debug.menu` (a loud
failure, never a false pass).

## A still, deterministic screen

An animating screen differed by about 1 % of its pixels between two captures a second apart, five
times the tolerance. So every capture has:

- the status bar pinned: iOS `simctl status_bar <udid> override --time 9:41 ...`, Android demo mode
  (clock 0941, full battery and Wi-Fi, no notification icons);
- animations held (`motion=still`: debug-menu-and-test-hooks' switch, the app's one reduce-motion
  path) and `waitForAnimationToEnd` before each shot; on Android the device step also sets
  `window_animation_scale`, `transition_animation_scale` and `animator_duration_scale` to 0
  (`stillAnimationCommands`), because `motion=still` holds only the app's own animations, not native
  transitions, ripples or system UI (animator_duration_scale 0 also turns on React Native's
  reduce-motion signal, which matches `motion=still`);
- a fixed day (`date=`), no network (`offline=1`), and the app's own deterministic data;
- `theme=system`, with the device appearance switched between light and dark
  (`simctl ui <udid> appearance`, `adb -s <serial> shell cmd uimode night yes|no`);
- one device model and runtime per baseline set: `<prefix>-shots-phone` and `<prefix>-shots-tablet`,
  or this session's `<prefix>-<purpose>` and `<prefix>-<purpose>-tablet` with `--sim`.

## Running it

`npm run screenshots:<platform> -- [--update] [--devices phone,tablet] [--locales en,ar] [--text-size default|largest] [--sim <purpose>] [--app-path <path>] [--driver-port <n>]`

`capture-screenshots.ts` checks the build (the same guard as the runner), empties
`reports/screenshots/<platform>/` (`<platform>-largest/` with `--text-size largest`), installs
Maestro, then for each device: opens and prepares it; for light, then dark: sets the appearance; for
each locale: runs the matrix flow through `runMaestro` with `-e APP_ID -e APP_SCHEME -e LANG -e THEME`
into `reports/screenshots/<platform>/raw/<device>/<locale>-<theme>/`, and compares each PNG with its
baseline (`screenshot-compare.ts`).

Each device x locale x theme is one combination: a device that does not start, a matrix flow that
fails, or a flow that passes without a screenshot becomes a `capture-failed` row (its error and its
Maestro output folder) and the next combination still runs. The capture always writes
`reports/screenshots/<platform>/summary.json` and `index.html` (failed combinations first, in red),
prints `<n> screenshots, <m> changed, <k> combinations failed; gallery: ...` and one
`capture failed: <set>: <error>` line each, and exits 1 when anything changed or failed. A bad command
line or a refused build exits 2 with the message.

Why a folder per platform, emptied first: `check-e2e-report --platform <p> --screenshots` reads
`reports/screenshots/<p>/summary.json`. With one shared summary, the Android capture overwrote the iOS
one, and a capture that stopped early left the previous run's summary behind to be read as this
run's. The checker also fails a row whose label is not of that platform (`screenshot-platform`) and
every `capture-failed` row (`screenshot-capture-failed`).

`compareScreenshot` returns `match`, `mismatch` (with the diff PNG), `size-changed` or
`missing-baseline`. The comparison needs no package: `png-diff.ts` reads 8-bit PNGs (what
`simctl io screenshot` and `adb screencap` write), uses pixelmatch's YIQ colour distance with a
per-pixel threshold of 0.1, and writes a diff with the changed pixels in red. It has no anti-aliasing
detection: a screen whose edges move is not still, and is fixed, not tolerated.

Why not golden-and-snapshot-tests' pixel matcher: `test/goldens/skia-golden.ts` is a Jest matcher
(`jest-image-snapshot`, which compares with pixelmatch at its default per-pixel threshold of 0.01 and
0.1 % of pixels), so it runs only inside a Jest test, and the capture runs under plain Node with no
package. Both use pixelmatch's YIQ colour distance; `png-diff.test.ts` pins that maths (a one-unit
change in one channel stays under 0.1). The thresholds differ on purpose: goldens compare CanvasKit
renders of a single canvas, the matrix compares whole device screenshots with system-drawn bars and
text. If golden-and-snapshot-tests ever ships a Node-safe decode-and-compare, switch to it and keep
these two thresholds.

Plan for minutes per set; narrow with `--devices` and `--locales` while iterating.

## Baselines

- Path: `.maestro/baselines/<platform>/<device>/<locale>-<theme>[-largest]/<screen>.png`, separate per
  platform (golden-and-snapshot-tests' policy; `.maestro/baselines/**` is a gated path in
  `quality-gates.json`, so every change needs a `Gate-Change:` trailer).
- First capture or an intended change: `--update`, narrowed to the sets the change touched; open every
  new PNG; commit with `Gate-Change: <which screens and why>`.
- Tolerance: 0.2 % of pixels at a 0.1 colour distance (`MAX_DIFF_RATIO`, `PIXEL_THRESHOLD`; pixel
  goldens use 0.1 %). Never raise either to hide a diff; a change needs the reviewer.
- A runtime, Xcode, system image or device model change regenerates the platform's baselines in one
  dedicated commit, after the old baselines passed on the old setup. run-goldens-rebaseline is the
  runbook for that wide regeneration: it records the baselines before the update, requires one
  inspection entry per changed PNG, and hands the proof back to this skill's compare run.
- `check-e2e-setup` checks that every set of a platform holds the same screens; with `--baselines` it
  also requires every set of the contract's matrix.

## Reviewing: open every changed PNG

Before calling UI work done, open every changed screenshot and its diff and check direction (the
right-to-left locale mirrored, canvases mirrored only when the app opts in), clipping, overlap,
truncated text, the colours of each theme, and the status and navigation bar areas on Android
(edge-to-edge). `check-e2e-report.mjs . --platform <p> --screenshots` lists every changed row with its
diff and fails until each is fixed or re-accepted.

A diff in a different place on each run means the screen is not still (an animation, a clock, a
blinking caret, random content): fix the setup, never the tolerance.

## The gallery

`write-gallery.ts` writes `reports/screenshots/<platform>/index.html`: one row per screenshot with
baseline | this run | diff, failed combinations first, then changed rows, paths relative to the page. Open it for the reviewer before a
release and name at most five rows worth their look in the report.

## The largest text size

`--text-size largest` captures the same matrix at the largest system size into
`<locale>-<theme>-largest/` sets, reported in `reports/screenshots/<platform>-largest/` (iOS
`accessibility-extra-extra-extra-large`, AX5, about 3.6x in React Native's font scale; Android font
scale 2.0). Check truncation and overlap by eye; these sets are optional in `--baselines`, and
`check-e2e-report --screenshots` reads only the default-size folder.

## Screenshots and the approved design

The matrix proves a screen did not change by accident. Whether a screen matches its approved design
in the first place is design-visual-parity's work; run it for a new or redesigned screen before
accepting its baselines.
