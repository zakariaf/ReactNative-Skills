# What to show the developer at the two stop-and-ask moments

## 1. Before the first update (after `--triage`)

> **Rebaseline plan: approve before I re-accept anything**
>
> Cause: `@shopify/react-native-skia` 2.6.2 to the new release (anti-aliasing of curved edges).
> Unit and Android projects: green, 168 test files (`assertions.json`).
> Triage (`triage.json`): 2 of 3 golden files fail, as the cause predicts:
>
> - `test/goldens/charts/weekly-chart.golden.test.ts`: 3 images, 0.2 to 0.6% of pixels, red only on
>   bar edges (composites: `reports/rebaseline/triage-diffs/weekly-chart-*-diff.png`)
> - `test/goldens/charts/progress-ring.golden.test.ts`: 9 images, ring edges only
>
> Not failing: `src/features/tasks/tasks-digest.golden.test.ts` (data golden, unaffected).
> Contract goldens: none fail. Obsolete entries: none. Orphans to delete: 1 PNG of the removed streak
> badge.
>
> Shall I re-accept these two files, one at a time?

## 2. Before the commit (after `check-rebaseline.mjs` passes)

> **Rebaseline done: approve the record before I commit**
>
> `check-rebaseline.mjs .` prints `RESULT: PASS`. 12 PNGs changed, 1 orphan deleted; each has an entry
> in `reports/rebaseline/inspection.json` (attached below with the new PNGs). The proof ran twice on
> the whole golden project without `-u`. Planned message: `reports/rebaseline/commit-message.txt`
> (it names both files and carries the Gate-Change trailer).
>
> Shall I commit?
