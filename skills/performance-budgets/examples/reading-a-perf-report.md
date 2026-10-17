# Worked example: judging a device performance report

The developer installed the internal (preview) Release build of a Tasks app on an iPhone, recorded frame
times while scrolling the longest list and completing tasks, ran the storage benchmark, relaunched the
app five times and shared the report. One more launch happened earlier the same day, after iOS had
prewarmed the app overnight, and the log still holds a slow list-scroll recording from build 11, which
was installed before (the log survives updates). The frames labels come from the screens' own
recordings (`setRecording(false, 'tasks/list-scroll')`; the menu's switch alone writes `debug-menu`).
The agent saved it as `reports/perf/ios-1.0.0-12.json`:

```json
{
 "appId": "com.example.tasks.preview",
 "appVersion": "1.0.0",
 "buildNumber": "12",
 "platform": "ios",
 "osVersion": "26.5",
 "deviceModel": "iPhone17,1",
 "entries": [
  { "kind": "frames", "label": "tasks/list-scroll", "atEpochMs": 1790410100000, "build": "11", "data": { "frames": 1440, "seconds": 12.1, "refreshHz": 120, "p50UpToMs": 9, "p95UpToMs": 34, "maxMs": 96, "hitchMsPerS": 18.2, "buckets": [1000, 200, 120, 70, 40, 10, 0] } },
  { "kind": "cold-start", "label": "tasks", "atEpochMs": 1790420000000, "build": "12", "data": { "nativeMs": 27840512, "jsMs": 310, "totalMs": 27840822, "prewarmed": true } },
  { "kind": "cold-start", "label": "tasks", "atEpochMs": 1790430000000, "build": "12", "data": { "nativeMs": 520, "jsMs": 300, "totalMs": 820, "prewarmed": false } },
  { "kind": "cold-start", "label": "tasks", "atEpochMs": 1790430000001, "build": "12", "data": { "nativeMs": 490, "jsMs": 300, "totalMs": 790, "prewarmed": false } },
  { "kind": "cold-start", "label": "tasks", "atEpochMs": 1790430000002, "build": "12", "data": { "nativeMs": 545, "jsMs": 300, "totalMs": 845, "prewarmed": false } },
  { "kind": "cold-start", "label": "tasks", "atEpochMs": 1790430000003, "build": "12", "data": { "nativeMs": 501, "jsMs": 300, "totalMs": 801, "prewarmed": false } },
  { "kind": "cold-start", "label": "tasks", "atEpochMs": 1790430000004, "build": "12", "data": { "nativeMs": 530, "jsMs": 300, "totalMs": 830, "prewarmed": false } },
  { "kind": "frames", "label": "tasks/list-scroll", "atEpochMs": 1790430100000, "build": "12", "data": { "frames": 1440, "seconds": 12.1, "refreshHz": 120, "p50UpToMs": 9, "p95UpToMs": 17, "maxMs": 41, "hitchMsPerS": 3.2, "buckets": [1300, 110, 20, 7, 3, 0, 0] } },
  { "kind": "frames", "label": "tasks/complete-animation", "atEpochMs": 1790430100000, "build": "12", "data": { "frames": 1440, "seconds": 12.1, "refreshHz": 120, "p50UpToMs": 9, "p95UpToMs": 17, "maxMs": 41, "hitchMsPerS": 6.4, "buckets": [1300, 110, 20, 7, 3, 0, 0] } },
  { "kind": "storage-benchmark", "label": "storage-write", "atEpochMs": 1790430200000, "build": "12", "data": { "p50": 0.4, "p95": 0.9, "max": 2.1, "writes": 300 } }
 ]
}
```

## Run the check

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-perf-report.mjs reports/perf/ios-1.0.0-12.json .
```

```
report: com.example.tasks.preview 1.0.0 (12) on iPhone17,1 (ios 26.5)
build 12: left out 1 entry from earlier builds (11)
cold start: left out 1 launch whose process started before the launch (prewarmed, or nativeMs over 10000 ms)
cold start: median 820 ms of 5 launches (limit 1000 ms)
frames tasks/list-scroll: 1440 frames at 120 Hz, p95 <= 17 ms, hitch 3.2 ms/s
frames tasks/complete-animation: 1440 frames at 120 Hz, p95 <= 17 ms, hitch 6.4 ms/s
storage write: p95 0.9 ms over 300 writes
check-perf-report: 10 report entries checked, 0 problems
RESULT: PASS
```

The Android report of the same build (`reports/perf/android-1.0.0-12.json`, a 90 Hz phone) is checked
the same way; its frames lines say `at 90 Hz`, and the hitch rate is measured against 11.1 ms frames.

## How to read it

- **Builds:** every entry carries the build that recorded it, and only build 12's entries are judged.
  Build 11's slow recording (hitch 18.2 ms/s) is left out: it measured the old code, and judging it
  would block the build that fixed it. Had build 12 no launches or benchmark of its own, the report
  would fail `cold-start-runs` and `storage-write-runs` instead of borrowing build 11's evidence.
- **Cold start** is the median `totalMs` of the latest five counted launches (process start to the
  first screen drawn with data). The prewarmed launch is left out: its process was created hours before
  the tap (7.7 hours of `nativeMs`), so it says nothing about launch speed. If more launches are left out
  than kept, ask for more relaunches rather than judging fewer. `nativeMs` (process start to the JS entry mark) is most of it. When the total grows,
  compare both parts across builds: a growing `jsMs` means module-scope or start-up work (a new
  provider, an SDK started before the first screen); a growing `nativeMs` means native start-up (new
  native modules, a heavier bundle to load).
- **Frames:** the buckets count frames up to 9 / 17 / 25 / 34 / 50 / 100 ms and slower; `p95UpToMs` 17
  means 95 % of frames finished within the 17 ms bucket (1,300 + 110 of 1,440). The hitch rate is
  milliseconds of lateness per second (good ≤ 10). The completion animation hitches twice as much as the
  scroll but stays within budget; if it trends up across builds, look at that animation first.
- **Storage write:** p95 0.9 ms on the device over 300 writes, far under 5 ms.

## Report it

Tell the reviewer the numbers per platform, the budget each is judged against, and the trend against the
previous release's report (`reports/perf/` keeps them):

```
Performance (preview build 12): iOS cold start 820 ms (budget 1,000), list scroll hitch 3.2 ms/s,
completion animation 6.4 ms/s (budget 10), storage write p95 0.9 ms (budget 5). Android: <same lines>.
All within budget; completion-animation hitches up from 4.1 ms/s in build 11.
```

## When it fails

Each `FAIL` line names the entry and the fix, for example
`FAIL reports/perf/ios-1.0.0-13.json [hitch-rate] tasks/complete-animation: hitch rate 14.2 ms/s is over 10 ms/s`.
A `p95UpToMs` of `null` means the p95 fell in the slowest bucket (over 100 ms; the app's `Infinity` is
written as `null` in JSON), and the check fails it. Reproduce the screen, find the per-frame work (React
state per frame, a Skia allocation in a worklet, many unbatched sprites, a callback that never stops, a
long list that mounts every row), fix it, and ask the developer for a new report. Never loosen the
budget to pass: that needs a device report that justifies it, the reviewer's approval and the
`Gate-Change:` trailer.
