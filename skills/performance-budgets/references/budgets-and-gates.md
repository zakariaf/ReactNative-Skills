# Budgets and quality-gates.json

The numbers an app stays within, where each one is measured on iOS and Android, how a budget may
change, and the measurements the starting values came from.

## Contents

- Three places, three jobs
- The budget table
- quality-gates.json
- Changing a budget
- Field metrics and tightening
- Where the starting values came from
- When multi-package

## Three places, three jobs

| Where | What it proves | Who runs it |
|---|---|---|
| **Real devices** (a Release build of the internal variant: an iOS TestFlight or ad-hoc build, an Android internal-testing or sideloaded release APK/AAB) | The truth before a release: cold start, frame times at the display's real rate (60, 90 or 120 Hz), storage write time | The developer, from the debug menu; the agent reads the shared JSON |
| **iOS simulator and Android emulator** (Release, internal variant, named devices) | Regressions only: launch time against the device's own committed baseline, memory after the smoke flow, layouts at large text | The agent, with the commands in the measuring reference |
| **Jest** | Fast guards that fail a commit: the storage write, draw calls per frame, re-render boundaries | The agent, through `npm run verify` |
| **The field** (Xcode Organizer, MetricKit, Play Console Android vitals) | The truth at scale after a release: launch time and hitches across users' devices, Play's startup and rendering vitals | The developer reads them after each release (the measuring reference's "Field metrics") |

A simulator or emulator is not a device: the iOS simulator runs on the Mac's CPU and caps at 60 fps, an
emulator's timing follows the host and its GPU emulation, so their numbers are compared only with their
own earlier numbers. Measure only **Release** builds: in development, JS runs unoptimised with
development checks on (React Native's performance guide: "JavaScript thread performance suffers greatly
when running in dev mode").

## The budget table

| Key (`quality-gates.json` `perf`) | Starting value | Measured by | iOS | Android |
|---|---|---|---|---|
| `coldStartHomeMsMax` | < 1,000 ms, median of the latest 5 launches | the cold-start marks + the native process start | device report | device report |
| `coldStartSimRegressionFactor` | ≤ 1.2 × the committed baseline | the same marks read from a simulator/emulator | `simctl` run | `adb` run |
| `hitchMsPerSecondMax` | ≤ 10 ms/s while animating | the frame recorder | device report | device report |
| `frameP95MsMax` | ≤ 17 ms (a bucket upper bound) | the frame recorder | device report | device report |
| `saveWriteP95MsMax` | < 5 ms (the per-change storage write) | Jest guard on `node:sqlite` + the device benchmark | both | both |
| `drawCallsPerFrameMax` | ≤ 1,000, the ceiling for every drawing's own budget | recording-canvas draw tests | Jest | Jest |
| `bundleJsBytesMax` | ≤ 6,000,000 bytes of minified JS | `expo export --no-bytecode`, per platform | export | export |
| `bundleGrowthMaxRatio` | ≤ 1.1 × the platform's committed baseline | the same export | export | export |
| `memoryFootprintMbMax` | ≤ 150 MB after the smoke flow | `footprint` (phys_footprint) / `dumpsys meminfo` (TOTAL PSS) | simulator | emulator |
| `skiaCanvasesPerScreenMax` | ≤ 8 per screen file outside the canvas folders | `check-perf-code.mjs` | code | code |

The key `saveWriteP95MsMax` keeps the name the canonical `quality-gates.json` carries; it limits the
per-change write whatever the storage is: one repository transaction (tables) or one document save.

Apple rates a hitch rate ≤ 10 ms/s good, ≤ 25 warning, ≤ 50 critical, and above 50 as needing immediate
attention (the Xcode Organizer's Hitches metric; verified on 2026-10-10 in "Understanding hitches in your
app"). The starting budget sits at the top of "good". A frame lasts 8.3 ms at 120 Hz, 11.1 ms at 90 Hz and 16.7 ms at
60 Hz; hitch time is the sum of `max(0, interval − frame length)` at the rate the report detected.

## quality-gates.json

Tests and checkers read the budgets from one checked-in file. quality-gates owns it (it is a gated path:
a change needs the `Gate-Change:` trailer); this skill owns the `perf` block's meaning. The block, as
`assets/perf-budgets.json` ships it:

```json
{
  "perf": {
    "coldStartHomeMsMax": 1000,
    "coldStartSimRegressionFactor": 1.2,
    "hitchMsPerSecondMax": 10,
    "frameP95MsMax": 17,
    "saveWriteP95MsMax": 5,
    "drawCallsPerFrameMax": 1000,
    "bundleJsBytesMax": 6000000,
    "bundleGrowthMaxRatio": 1.1,
    "memoryFootprintMbMax": 150,
    "skiaCanvasesPerScreenMax": 8
  }
}
```

`check-budgets.mjs` fails a missing key, a value that is not a positive number, an unknown key (a typo
or a budget nothing reads), and a value looser than the starting value. It compares with the starting
value only: it cannot see that an app already tightened a budget (say `coldStartHomeMsMax` 700) and is
now loosening it again (to 950). That loosening is caught by quality-gates' `Gate-Change:` trailer,
which a change to the gated `quality-gates.json` needs, and by the reviewer reading the diff. Readers: `check-perf-code.mjs`
(draw-call ceiling, canvases), `check-perf-report.mjs` (cold start, frames, storage),
`check-bundle-size.mjs` (bundle), the storage guard `test/perf/storage-write.perf.test.ts`, and the
simulator/emulator memory step. The baselines live beside it in `perf-baselines/` (a gated path too):
`cold-start-sim-ios.json` and `cold-start-emu-android.json` (`{ "medianMs": n }`),
`bundle-ios.json` and `bundle-android.json` (`{ "bundleJsBytes": n }`).

## Changing a budget

- **Tightening** is always allowed, after a device report shows the headroom. Do it: a loose budget
  hides the next regression.
- **Loosening** needs, in this order: a device report on each platform that justifies it, the
  reviewer's approval, and a commit with the `Gate-Change:` trailer. Above the starting value it also
  needs `check-budgets.mjs . --allow <key>` for that key; between a tightened value and the starting
  value the trailer and the review are the gate (the checker only knows the starting values). Stop and
  ask before loosening.
- **One drawing's draw-call budget** may rise only with a device frame report showing the hitch rate
  within budget at the new count, and never above `drawCallsPerFrameMax`.
- **A slower simulator or emulator baseline** is a loosening too: the same approval and trailer.
- **A canvas-heavy screen** that truly needs more canvases goes into `contracts/perf.json`
  `canvasBudgetExempt` with the measurement as its reason, instead of a looser global budget.

## Field metrics and tightening

After a release has been out long enough for the field data to fill (Xcode Organizer and Play Console
aggregate over days), compare it with the device reports of that build:

- **Field better than the budget with headroom on both platforms:** tighten the budget toward the field
  value plus a margin (the device report must agree; the field number stops at the first frame, the
  budget at the first screen drawn with data).
- **Field worse than the device reports:** the test phones are not representative. Add a slower phone to
  the device steps (a mid-range Android phone is the usual gap) instead of loosening the budget.
- **Organizer Hitches above 10 ms/s for an animation type, or Play's slow/frozen frames rising:** find that
  screen, record frames on it in the device lane, and fix it before the next release.
- **Play's startup vitals** (cold start ≥ 5 s is excessive) are a floor, far above the 1,000 ms budget: an
  app that shows up there has a device-specific problem the median hides.

The budgets stay in `quality-gates.json`; field numbers are evidence in the pull request that changes
them, never a budget of their own.

## Where the starting values came from

The values are starting defaults from probes and one production app, measured on Expo SDK 57 (React
Native 0.86.3, Hermes V1, Reanimated 4.5.1, Skia 2.6.2) in September 2026 on the iOS 26.5 simulator and a
Mac. Android was not measured: treat every Android number as the same starting value and tighten it from
the first Android device report.

- A probe app's footprint was 42 MB, and 66 MB with 90 Skia canvases mounted.
- A scene of about 265 draw calls re-recorded every frame held 60 fps on the simulator.
- Process start to the first frame: median 539 ms over 66 cold launches of a probe app, 484 ms of it
  before the first JS module ran (JS then took a median of 30 ms).
- The storage write on the Mac (WAL, `synchronous = FULL`, `node:sqlite`): p50 about 0.01–0.12 ms, p95
  about 0.02–0.17 ms. The 5 ms budget, with more than 30× headroom, is a regression guard: it catches a
  missing transaction, a write per row or a serializer that grows with the data, not device I/O.
- Bundle sizes (minified JS, iOS export): an app shell without the FormatJS polyfills 1,136,696 bytes,
  with the forced polyfills for four languages 1,983,418 bytes, a probe with Skia, Reanimated, Gesture
  Handler, audio and FlashList 2,314,613 bytes. 6 MB leaves room for an app; tighten it to about
  1.2 × the first production export.
- The reference Tasks app with the whole canonical stack installed (Expo Router, Reanimated, Skia,
  react-intl with forced polyfills for two languages, TanStack Query, the data layer), production variant,
  `expo export --no-bytecode` on 2026-10-10: iOS 3,614,123 bytes, Android 3,774,436 bytes of minified JS.
- The template storage guard on that app (1,000 tasks, 300 `setDone` writes, `node:sqlite` on a Mac,
  2026-10-10): p50 0.02 ms, p95 0.03 ms.

Re-verify after an SDK move: rerun the bundle exports, the simulator and emulator cold-start runs and
the list measurement (the measuring reference has each command), then compare with the baselines.

## When multi-package

Each app workspace keeps its own `perf-baselines/` entries (`bundle-ios-<app>.json`), while the budgets
stay in the repo root's `quality-gates.json` unless an app needs its own (then each app's folder holds
one, and the checkers take that folder as the repo root).
