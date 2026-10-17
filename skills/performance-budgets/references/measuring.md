# Measuring: frames, cold start, storage, draw calls, bundle, memory, lists

How each budget is measured on iOS and Android, what the templates do, and the exact commands. Every
device command names its device: a simulator by UDID, an emulator or phone by `adb -s <serial>`, an AVD
by name; simulators and emulators are named `<project>-<purpose>` (for example `tasks-perf`).

## Contents

- The measurement layer at a glance
- Frame-time recorder
- The perf log and the shared report
- The debug menu's Performance actions
- Cold start
- Prewarmed and background-started processes
- Simulator and emulator cold-start runs
- Storage-write performance
- Draw-call budget
- Bundle size
- Memory
- Measuring a list
- The developer's device steps
- Field metrics (production)
- Re-verify

## The measurement layer at a glance

| Piece | File (template) | Runs in |
|---|---|---|
| Frame histogram and report (pure, 120/90/60 Hz) | `src/core/perf/frame-histogram.ts`, `frame-report.ts` | every build (tiny) |
| Perf entries, ring buffer, report JSON (pure) | `src/core/perf/perf-entry.ts` | every build |
| Write-time summary and benchmark loop (pure) | `src/core/perf/write-times.ts` | tests, test builds |
| Cold-start report (pure) | `src/core/perf/cold-start.ts` | every build |
| `PerfPort`: clocks, process start, build header, share sheet | `src/services/perf/perf-port.ts`, `expo-perf-adapter.ts`, `fake-perf.ts` | every build (created by the composition root) |
| The two JS marks of a launch | `src/services/perf/cold-start-marks.ts`, `src/hooks/use-cold-start-mark.ts` | every build (logs only with a perf log) |
| Frame recorder (`sampleFrame`) | `src/services/perf/frame-recorder.ts` | test builds (store builds never start it) |
| The debug menu's Performance actions | `src/services/perf/perf-debug-actions.ts` | test builds, through the test-only entry |
| `PerfLogPort` on expo-sqlite/kv-store | `src/services/perf-log/` | test builds, through the test-only entry |
| Process start, natively | `modules/process-start/` (iOS Swift, Android Kotlin) | every build |
| Storage-write Jest guard | `test/perf/storage-write.perf.test.ts` | Jest |

`contracts/perf.json` declares the layer (`layer.jsEntryFile`, `layer.firstScreenFiles`,
`layer.testOnlyEntry`, `layer.nativeModuleDir`); `check-perf-code.mjs` then fails while a file or a
wiring line is missing (`perf-layer`, `debug-perf-wired`). The only two app files that read clocks for
instrumentation are the `src/services/perf/*-adapter.ts` files (the canonical ESLint config's
`PERF_CLOCK_FILES` exemption); everything else receives time from the port.

## Frame-time recorder

- The histogram is a small immutable record: 7 buckets bounded at 9 / 17 / 25 / 34 / 50 / 100 ms and
  above, plus frames, total, min, max and hitch time at 120, 90 and 60 Hz. `recordFrame` is a pure
  worklet; a first-frame interval of 0 is skipped.
- Hitch time is Σ max(0, interval − frame length); the hitch rate is hitch time per recorded second
  (Apple's metric). The report picks the rate from the shortest interval, split midway between rates:
  under 9.7 ms is 120 Hz, under 13.9 ms is 90 Hz, otherwise 60 Hz. Without the 90 Hz step a 90 Hz Android
  phone would be judged against 8.3 ms frames and show about 250 ms/s of false hitches.
- **iOS 120 Hz:** ProMotion iPhones run a third-party app above 60 fps only with
  `CADisableMinimumFrameDurationOnPhone = true` in Info.plist. Expo's prebuild template sets it (SDK 57),
  so a Continuous Native Generation app writes nothing; skia-canvas-rendering's `plist-120hz` fails an
  override that turns it off. A device report saying `refreshHz: 60` on a ProMotion phone means it was
  turned off.
- **Android:** no key. Frame callbacks follow `Choreographer` at the display's current rate (60, 90 or
  120 Hz, chosen by the system and the device's power settings). Confirm with Developer options › Show
  refresh rate, or `adb -s <serial> shell dumpsys gfxinfo <package> framestats` (from Android's
  documentation; not verified on a device for this skill).
- **The recorder never owns a frame callback.** In a test build the Performance actions hold one
  recorder (`createFrameRecorder()`, shared values made once with `makeMutable`); the frame callbacks
  that already run sample it: a canvas surface passes
  `onFrameTime: (dt) => { 'worklet'; sampleFrame(actions.frames, dt); }` to `useSurfacePlayer`, a loop
  runner calls the same. Store builds pass nothing.
- Switching "Record frame times" off appends one `frames` entry with the `FrameReport`, or nothing when
  no frame ran.

## The perf log and the shared report

- `PerfLogPort` (test builds only) keeps a ring buffer: the newest 200 evidence entries (`frames`,
  `cold-start`, `storage-benchmark`) and, beside them, the newest 400 `trace` entries, so a trace never
  evicts evidence. The adapter stores it as one JSON value under the key `perf.log` in its own
  expo-sqlite/kv-store database, `new SQLiteStorage('perf-log.db')`: not the app's database and not the
  default `ExpoSQLiteStorage` file the app's small preferences share. A reset, an export or a migration
  of the user's data never touches it, nor does a preferences clear (`Storage.clear()`); it survives app
  updates, and only deleting the app removes it.
- An entry: `{ "kind": "frames" | "cold-start" | "storage-benchmark" | "trace", "label", "atEpochMs",
  "build", "data" }` (`data` values are numbers, booleans, `null` or number arrays). For example:

```json
{ "kind": "frames", "label": "tasks/list-scroll", "atEpochMs": 1790430000000, "build": "12",
  "data": { "frames": 1440, "seconds": 12.1, "refreshHz": 120, "p50UpToMs": 9, "p95UpToMs": 17,
            "maxMs": 41, "hitchMsPerS": 3.2, "buckets": [1300, 110, 20, 7, 3, 0, 0] } }
```

- **Every entry carries the build that recorded it** (`build`: the native build number,
  `perf.header().buildNumber`, stamped by `useColdStartMark`, `setRecording` and the benchmark). The
  log survives app updates, so after build 14 is installed over build 13 it still holds build 13's
  launches and recordings; `check-perf-report.mjs` judges only the entries of the report header's
  `buildNumber` and prints `build 14: left out <n> entries from earlier builds`. A fixed build is
  therefore never failed by an old recording, and a build with no launches or benchmark of its own
  fails `cold-start-runs` / `storage-write-runs`. Entries without a stamp (a log written before
  stamping) are judged as the header's build, with a note. For a bare entries array pass `--build <n>`.
- `p50UpToMs` / `p95UpToMs` are bucket upper bounds; a percentile in the slowest bucket is `Infinity`,
  which JSON writes as `null`, and `check-perf-report.mjs` fails it.
- "Share performance report" opens the system share sheet with `{ appId, appVersion, buildNumber,
  platform, osVersion, deviceModel, entries }` (`perfReportJson`). The identity is read natively:
  expo-application's `applicationId`, `nativeApplicationVersion` and `nativeBuildVersion` (the build
  number the installed binary carries, right under EAS remote versioning and `autoIncrement`, where the
  app config's `buildNumber`/`versionCode` are not what shipped), `Platform.Version` as `osVersion`, and
  the ProcessStart module's `getDeviceModel()` (`iPhone17,1`, `Google Pixel 9`; a simulator adds
  `(simulator)`). The app itself sends nothing anywhere.
- Reading the log from a simulator (Release build, UDID named):

```sh
DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data)
sqlite3 "$DATA/Documents/SQLite/perf-log.db" "SELECT value FROM storage WHERE key = 'perf.log'" > reports/perf/sim-perf-log.json
```

- From an emulator: a release build is not debuggable, so `run-as` refuses it. On an emulator image
  without Google Play, `adb -s <serial> root` works; then
  `adb -s <serial> pull /data/data/<package>/files/SQLite/perf-log.db reports/perf/emu.db` and the
  same `sqlite3` query (from Android's documentation; not verified for this skill). Otherwise share the
  report from the emulator's debug menu.

## The debug menu's Performance actions

Test builds only (the debug menu of debug-menu-and-test-hooks, reached through the test-only entry):
`createPerfDebugActions({ perfLog, perf, openBenchmark })` gives the section its actions.

| Row | Action | What it does |
|---|---|---|
| "Record frame times" (switch) | `isRecording()`, `setRecording(isOn, label?)` | on: a fresh histogram that frame runners feed; off: one `frames` entry labelled with what was measured (the menu's switch passes nothing: `debug-menu`; a screen that records its own run passes e.g. `tasks/list-scroll`) |
| "Run storage benchmark" | `runStorageBenchmark()` | opens `perf-bench.db` through `openBenchmark` (`createTasksBenchmarkOpener` of `src/data/perf/tasks-benchmark.ts`: the app's real data layer, seeded with its largest realistic data, deleted on close), times 300 per-change writes after 20 warm-ups with `perf.highResMs`, closes it, appends `{ kind: 'storage-benchmark', label: 'storage-write', data: { p50, p95, max, writes } }` |
| "Share performance report" | `share()` | the share sheet with the whole log and the build header; a sheet that cannot open is a `Result` failure, a dismissed one is not |
| The summary line | `summary()` | how many entries of each kind the log holds |

## Cold start

- **Why a native module:** React Native's startup marks begin when the JS bundle starts loading, not
  when the process starts. Measured on the iOS 26.5 simulator (66 cold launches of a probe app): process
  start to first frame had a median of 539 ms, 484 ms of it before the app's first JS module ran; JS
  then took a median of 30 ms. JS-only timing would miss about 90 % of the launch.
- **iOS:** `ProcessStartInfo.swift` (called by `ProcessStartModule.swift`) reads the process start from
  the kernel (`sysctl` with `KERN_PROC_PID`, `kp_proc.p_starttime`) as epoch ms. Verified in the source
  app: it compiled and ran in a Release simulator build, autolinked from a workspace package; the
  `modules/process-start` folder form and a physical iPhone are not yet verified.
- **Android:** `ProcessStartInfo.kt` reads `Process.getStartRequestedElapsedRealtime()` (API 33+, the
  moment the launch was requested, before the zygote fork) or `Process.getStartElapsedRealtime()` (API
  24+), and converts it to epoch ms with the current offset between `SystemClock.elapsedRealtime()` and
  `System.currentTimeMillis()`. The helper compiles against the API 36 `android.jar`; the Gradle module
  (mirroring Expo's `expo-module-template-local` 0.7.10: empty `AndroidManifest.xml`, `lintOptions`) has
  not been built in an app yet. The first emulator build is its proof: until then the Android lane is
  unverified.
- **The module is a local Expo module:** `modules/process-start/` with `expo-module.config.json`
  (`apple.modules`, `android.modules`), no `package.json` needed (autolinking searches `./modules` by
  default, verified in expo-modules-autolinking 57). Only `expo-perf-adapter.ts` touches it, through
  `requireOptionalNativeModule('ProcessStart')`, so Jest and web answer `null`.
- **The JS entry mark:** `markJsEntry(services.perf.epochMs())` once, in the root layout's startup
  decision (the first-render initializer that creates the composition root), never at module scope. A
  reload (a direction restart, an OTA update) starts a new JS runtime, which marks again; label those
  launches and leave them out of the budget. Not at the top of `index.ts`: that is module scope (no
  composition root, no port, work at import time). The cost is only where the split falls: the
  evaluation of the route modules lands in `nativeMs` instead of `jsMs`, while `totalMs`, the number
  the budget judges, is the same.
- **The first-screen mark:** `useColdStartMark({ perf, perfLog, label, isReady })` in the first screen's
  model hook, called on every render. `isReady` is true once the screen shows its real data: for a
  TanStack Query screen `query.isSuccess` (or "the first page is in"), for data loaded before the screen
  `true`. A spinner or a skeleton is not the first screen: marking it would stop `totalMs` before the
  work the budget is about. One frame after the first ready commit (`requestAnimationFrame`) it records
  `{ nativeMs, jsMs, totalMs, prewarmed }` once per runtime; `perfLog` is null in store builds, so
  nothing is logged there. A screen whose data can fail to load marks nothing on that launch (the
  report then has one cold start fewer, which `cold-start-runs` notices).
- `check-perf-report.mjs` judges only the latest 5 counted cold starts of a device report
  (`--min-launches`): the log survives updates, so older builds' launches are still in it. A device
  report with no cold-start entry at all fails (`cold-start-runs`): the first-screen mark is not wired,
  `isReady` never became true, or the relaunches were skipped.

## Prewarmed and background-started processes

Cold start is measured from the process start, so a process that existed before the user's launch
reports a `nativeMs` of minutes or hours. Both platforms create such processes:

- **iOS prewarming (iOS 15+).** Apple's "About the app launch sequence": the system may prewarm an app,
  which "creates your process and loads the libraries your app links against, then suspends your process
  without allowing any application code to run", until the user's launch continues it (after a reboot,
  and periodically). A prewarmed process carries `ActivePrewarm=1` in its environment (the signal
  Apple named when prewarming arrived with iOS 15; it is not on the current documentation pages, so it is
  unverified for this skill); `ProcessStartInfo.wasPrewarmed()` reads it. A launch for a silent push or a background
  task that later becomes visible has the same shape and no flag: the stale-start bound below catches it.
- **Android background starts.** A push message (expo-notifications), a broadcast, a job or a background
  task (expo-background-task) can start the process long before the user opens the app. Android 15
  (API 35) records why: `ActivityManager.getHistoricalProcessStartReasons(1)` returns the most recent
  `ApplicationStartInfo` first; `ProcessStartInfo.wasStartedInBackground()` flags it when its `pid` is
  this process and its reason is not `START_REASON_LAUNCHER`, `START_REASON_LAUNCHER_RECENTS` or
  `START_REASON_START_ACTIVITY` (so `START_REASON_PUSH`, `BROADCAST`, `JOB`, `SERVICE`, `ALARM`, ...).
- **Older versions and unflagged cases.** `coldStartReport` also sets `prewarmed: true` when `nativeMs` is
  over `STALE_PROCESS_START_MS` (10,000 ms): no real launch spends 10 s before the first JS module.

The app keeps the measured numbers in the entry (they help diagnose) and sets `prewarmed: true`;
`check-perf-report.mjs` leaves those launches out of the median, applies the same 10,000 ms bound to
reports from builds without the flag, and prints `cold start: left out <n> launches whose process
started before the launch ...`. Relaunch until 5 counted launches remain.

Verification status: the Swift helper type-checks against the iOS 26.5 simulator SDK and ran on macOS
(`ActivePrewarm=1` read as prewarmed); the Kotlin helper compiles against the API 36 `android.jar`. No
prewarmed or push-started launch has been observed on hardware yet: treat the flags as unverified on
devices until a device report shows one.

## Simulator and emulator cold-start runs

Release build of the internal variant, installed on a named device (ios-simulator-build,
android-emulator-build), after the smoke flows (e2e-maestro runs those; its runner hosts no cold-start
or memory step, so this run is this skill's own). Six launches, the first dropped as
warm-up, the median of the other five compared with the committed baseline × 1.2.

```sh
# iOS: 6 times
xcrun simctl terminate "$UDID" "$BUNDLE_ID"; xcrun simctl launch "$UDID" "$BUNDLE_ID"
#   ...wait until the perf log holds a newer cold-start entry (the sqlite3 read above), then:
node ${CLAUDE_SKILL_DIR}/scripts/check-perf-report.mjs reports/perf/sim-perf-log.json . --sim-baseline-file perf-baselines/cold-start-sim-ios.json --build <build number>
#   the first accepted run: add --write-sim-baseline (writes { "medianMs", "launches", "build" }), then commit the file

# Android: 6 times
adb -s "$SERIAL" shell am force-stop "$PACKAGE"
adb -s "$SERIAL" shell am start -W -n "$PACKAGE/.MainActivity"   # prints TotalTime: a cross-check to the first activity frame
#   ...read the log (above), then the same check with --sim-baseline-file perf-baselines/cold-start-emu-android.json
```

- The baseline is committed as `perf-baselines/cold-start-sim-ios.json` /
  `cold-start-emu-android.json` = `{ "medianMs": n, ... }`. The first accepted run writes it
  (`--write-sim-baseline`, which refuses to overwrite an existing file); without the file and without
  that option the check stops with exit 2, never a silent pass. A slower new baseline is a deliberate
  delete-and-rewrite that needs the reviewer's approval and the `Gate-Change:` trailer.
  (`--sim-baseline <ms>` takes the median as a number instead.)
- The runner is the developer (or a CI job of this skill's own): after the smoke flows it terminates
  and launches the app six times, reads the log and runs this check, then takes the memory reading
  below. e2e-maestro documents this skill as the hand-off for both.
- `am start -W` stops at the first frame of the activity (Android's "time to initial display"), before
  the JS bundle has drawn the first screen; the perf layer's `totalMs` is the number the budget applies
  to. Reference on the iOS simulator: `simctl launch` to first frame, median 648 ms.

## Storage-write performance

- **Jest guard** (`test/perf/storage-write.perf.test.ts`): the same opener and seed as the device
  benchmark (`createTasksBenchmarkOpener` and `seedLargestRealisticTasks` in
  `src/data/perf/tasks-benchmark.ts`, so the two cannot drift): the app's own open path (WAL,
  `synchronous = FULL`) on Node's built-in `node:sqlite`, the largest realistic data (the template seeds
  1,000 tasks), 300 timed per-change writes (the template toggles a task) after 20 warm-ups; asserts
  `writes` is 300 and p95 is under `perf.saveWriteP95MsMax`, read from `quality-gates.json`. It lives in
  the root `test/` folder because it imports Node built-ins. Replace the seed and the write in
  `tasks-benchmark.ts` with the app's heaviest per-change write (`test/sqlite/tasks-benchmark.test.ts`
  proves the opener seeds, writes and deletes its scratch file).
- **Time Jest perf tests with `performance` from `node:perf_hooks`,** never the global
  `performance.now()`: the React Native Jest preset replaces it with a 1 ms `Date.now` mock (a first
  version of such a test reported p50 = 0.00 ms).
- **On the device:** the "Run storage benchmark" action writes the same kind of data into the scratch
  `perf-bench.db` through the real expo-sqlite driver and appends the entry; `check-perf-report.mjs`
  applies the same budget (`storage-write-p95`) and needs `writes` of at least 300
  (`storage-write-runs`).

## Draw-call budget

- Each custom drawing has a draw test (skia-canvas-rendering's `draw-*.test.ts`) that feeds its busiest
  frame to `draw()` through a recording canvas (a `Proxy` that counts every canvas call) and asserts
  `expect(total).toBeLessThanOrEqual(<budget>)` or declares `const DRAW_CALL_BUDGET = <n>`. It runs in
  the `unit` Jest project because `draw` receives its Skia objects through the kit.
- `check-perf-code.mjs` (`draw-call-budget`) fails a budget above `perf.drawCallsPerFrameMax`, so an app
  that tightened the ceiling to 400 sees every drawing that still asserts 600.

## Bundle size

```sh
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --no-bytecode --output-dir reports/perf/export-ios
node ${CLAUDE_SKILL_DIR}/scripts/check-bundle-size.mjs reports/perf/export-ios . --platform ios

APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform android --no-bytecode --output-dir reports/perf/export-android
node ${CLAUDE_SKILL_DIR}/scripts/check-bundle-size.mjs reports/perf/export-android . --platform android
```

- The baseline is `perf-baselines/bundle-<platform>.json` under the repo root (`--baseline <file>`
  names another, still relative to the repo root, whatever the current folder). The growth check always
  runs: a missing baseline is exit 2. First run: add `--write-baseline` and commit the file. An approved growth: rewrite it with the
  `Gate-Change:` trailer. Without `--no-bytecode` the export holds Hermes bytecode (`.hbc`), which the
  checker refuses (exit 2).
- The production variant matters: a development export carries test-only code (the bundle proof of
  app-variants-and-environment), so its size says nothing about the store build.

## Memory

After the smoke flow, on the simulator or emulator, with the app in the foreground:

```sh
# iOS: phys_footprint of the app's process (no sudo for simulator apps)
PID=$(pgrep -f "Devices/$UDID/.*/$APP_NAME\.app/$APP_NAME")
footprint --pid "$PID" -j reports/perf/footprint.json -f bytes --noCategories

# Android: TOTAL PSS in kB (the "TOTAL PSS:" line of the App Summary)
adb -s "$SERIAL" shell dumpsys meminfo "$PACKAGE" > reports/perf/meminfo-android.txt

# Judge it (rule memory-footprint, perf.memoryFootprintMbMax), with or without the cold-start log
node ${CLAUDE_SKILL_DIR}/scripts/check-perf-report.mjs reports/perf/sim-perf-log.json . --sim-baseline-file perf-baselines/cold-start-sim-ios.json --memory reports/perf/footprint.json
```

- Decoded images dominate the footprint of an image-heavy screen: a bitmap costs width × height × 4
  bytes whatever its file size (a 12 MP photo is 48.8 MB decoded). media-images-and-files'
  `src/core/media/image-fit.ts` (`decodedBytes`, `pixelsForPoints`, tested) does that arithmetic;
  decode at the displayed size before reaching for a bigger budget.
- `--memory` reads `footprint -j` JSON (one process; `processes[0].auxiliary.phys_footprint` in
  bytes, verified on macOS 27 / 2026-10-10) or saved `dumpsys meminfo` text (`TOTAL PSS:`, else the
  `TOTAL` row), and fails over the budget.

- The budget is in MB (1,048,576 bytes; Android's kB / 1,024). iOS `phys_footprint` is what the
  system's memory limit judges; Android `TOTAL PSS` shares common pages across processes, so the two
  numbers differ for the same app: keep one baseline per platform and tighten each from its own
  reports. (The Android command is from its documentation; not run for this skill.)
- Costs to keep in mind: one Skia `<Canvas>` (48 × 15 pt at 3×) ≈ 0.18 MB; a rasterized 24 pt icon at 3×
  is a 0.3–1.4 KB PNG; a pre-rendered texture costs `w × h × 4` bytes; one second of mono float audio at
  48 kHz is 192 KB.

## Measuring a list

Before choosing FlashList over `FlatList` (or keeping a `ScrollView` for a bounded list): a Release
build on a named simulator and a named emulator, five or six cold launches each, medians of render to
first frame, render to the last row laid out (`onLayout` of the last row), rows mounted after 1.5 s, and
memory (above). Write the numbers into the pull request; the switch needs the improvement on both
platforms. The performance rules reference has one measured example.

## The developer's device steps

A human step with a Release build of the internal variant on each platform, before each release (tell
the developer when the builds are ready: a TestFlight or ad-hoc build on iOS, an internal-testing track
or a sideloaded release build on Android):

1. Debug menu › Performance › switch on "Record frame times".
2. Use the busiest screens normally for at least 60 seconds: scroll the longest list, play every
   animation, open the canvas screens.
3. Switch recording off, run "Run storage benchmark" once, then force-quit and relaunch the app five
   times (five cold starts; leave out a launch that restarted for a language direction).
4. Debug menu › Performance › "Share performance report", and send it (AirDrop, a file, a paste).

Save each as `reports/perf/<platform>-<version>-<build>.json` and run
`node ${CLAUDE_SKILL_DIR}/scripts/check-perf-report.mjs <report.json> .`. The steps are per build: the
checker judges only entries stamped with the header's build number, so after installing a new build
over an old one, repeat steps 1-4 on the new build. A device report must hold at least 5 counted cold
starts of this build, at least one frame recording and one storage benchmark; a missing one is a
`FAIL` (`cold-start-runs`, `frame-data`, `storage-write-runs`), never a silent pass.

## Field metrics (production)

The device lane proves a build on a few phones before it ships; the field metrics are the truth at scale
afterwards, from real users' devices, and Play uses its own to rank apps. Read them after each release
and feed them into the budgets (the budgets reference says how).

- **iOS, Xcode Organizer › Metrics** (aggregated from users who share analytics with developers, no
  code needed): **Launch Time** is "the number of milliseconds between the user tapping your icon and
  when your first screen is drawn, after the static splash" (time to first frame, the same thing
  MetricKit measures). **Hitches** is the hitch rate per animation type: "at or below 10 ms/s is good;
  at or below 25 ms/s is a warning; at or below 50 ms/s is critical; and above 50 ms/s warrants immediate
  attention". **MetricKit** (`MXMetricManager`, daily `MXMetricPayload`: `MXAppLaunchMetric` launch
  histograms, `MXAnimationMetric` scroll hitch ratio) is the programmatic source of the same data, for
  an app that forwards it to its own backend.
- **Android, Play Console › Android vitals:** startup times are excessive when a cold start takes 5 s or
  longer, a warm start 2 s or longer, a hot start 1.5 s or longer (measured as time to initial display,
  the same point `am start -W` reports); slow frames take longer than 16 ms, frozen frames longer than
  700 ms. The core vitals with bad-behaviour thresholds that affect visibility on Google Play are the
  user-perceived crash rate (1.09 % overall, 8 % per phone model) and ANR rate (0.47 % overall, 8 % per
  phone model).
- **Optional tracing.** Production performance monitoring (Sentry's app-start and frame tracing, or
  forwarding MetricKit payloads) is fine and complementary: it is crash-reporting-and-observability's
  job, off by default (`TRACES_SAMPLE_RATE` 0), behind the person's crash-report consent and capped by
  its contract (`maxTracesSampleRate`). The rule that the perf log never uploads applies to this
  skill's test-build log, not to such monitoring. Sentry's app-start span is not a substitute for
  `totalMs`: without `Sentry.wrap` (which that skill forbids) it ends at the bundle start and
  undercounts, so cold start stays this skill's measurement; Sentry adds slow and frozen frames, JS
  stalls and navigation spans.
- Note the difference: the field metrics stop at the first frame (iOS) or the first activity frame
  (Android); this skill's `totalMs` stops at the first screen drawn with data, so it is the larger number.

Verified on 2026-10-10 from Apple's "Understanding hitches in your app" and "Reducing your app's launch
time", and Android's "App startup time" (Play vitals), "Slow rendering" and "Android vitals" pages.
Re-verify: open those pages; Play's thresholds change without notice.

## Re-verify

Verified on 2026-10-10 against Expo SDK 57 (expo 57.0.26), React Native 0.86.3, Reanimated 4.5.1,
Worklets 0.10.1 and Skia 2.6.2 by reading the installed sources and running the templates' tests; the
iOS measurements are from September 2026, the Android paths are unmeasured. After an SDK move:

- `useFrameCallback`'s frame info still has `timeSincePreviousFrame`:
  `grep -n timeSincePreviousFrame node_modules/react-native-reanimated/lib/typescript/frameCallback/*.d.ts`.
- Autolinking still searches `./modules`: `grep -n "'./modules'" node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js`.
- kv-store still takes a database name: `grep -n "class SQLiteStorage\|constructor" node_modules/expo-sqlite/src/Storage.ts`.
- The native helpers still compile: `xcrun -sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.4-simulator modules/process-start/ios/ProcessStartInfo.swift`,
  and the Kotlin helper in an emulator build (`ApplicationStartInfo` needs compileSdk 35 or newer).
- expo-application still exports the native identity: `grep -n "nativeBuildVersion\|applicationId" node_modules/expo-application/build/Application.d.ts`.
- Rerun the bundle exports, the cold-start runs and the list measurement, and compare with the
  baselines.
