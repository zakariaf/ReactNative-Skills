# Statistics and the completion write

What a statistics screen shows, what is stored to show it, how one completion updates everything in
one write, and how the screen receives finished numbers. `scripts/check-streaks-and-stats.mjs` runs
`recordActivity`, `measureCounters`, `buildStatsSummary` and `recordCompletion` against these rules.

## Contents

- What is stored, and why each field
- recordActivity: the fold
- Custom counters
- The completion write: one fold, one transaction, then publish
- The statistics summary
- Formatting at the edge
- The empty state and "Reset statistics"
- Mapping for a Tasks app
- What the checker runs

## What is stored, and why each field

```ts
// src/core/stats/activity-stats.ts (pure; template)
type ActivityStats = {
  total: number; successes: number; failures: number; durationMs: number;
  currentRun: number; longestRun: number;                        // consecutive successes
  bestDay: { date: DateKey; count: number } | null;              // the busiest day ever
  perDay: Record<DateKey, { count: number; durationMs: number }>; // the last 14 days
  counters: Record<string, number>;                              // by counter id
};
EMPTY_ACTIVITY_STATS   // a new user, and what "Reset statistics" writes
STATS_KEEP_DAYS = 14   // a 7-day chart needs 7; 14 leaves room for a "this week vs last week" card
```

Store only what cannot be derived from what the app keeps (the streaks reference, "One source of
truth"). The per-day buckets are a window, so anything that must outlive the window is its own field:
`total` (never `sum(perDay)`), `bestDay` (never `max(perDay)`), `longestRun`. A rate is never stored:
it is derived from two counts on read.

## recordActivity: the fold

```ts
recordActivity(stats, event, day): ActivityStats
// event: { isSuccess, durationMs, counters: Record<id, { value, aggregate }> }
```

- `total + 1`; `successes + 1` or `failures + 1`; `durationMs + event.durationMs`.
- `currentRun = isSuccess ? currentRun + 1 : 0`; `longestRun = max(longestRun, currentRun)`. Any
  failure resets the run, whatever its kind.
- `perDay[day] += { count: 1, durationMs }`, then keep only the dates fewer than `STATS_KEEP_DAYS`
  days before the newest bucket (counted from the newest, so a clock set back cannot drop today's
  bucket). An event on a day already older than the window counts in the totals and adds no bucket.
- `bestDay` becomes `{ date: day, count }` when that day's bucket passes the record (ties keep the
  earlier day).
- Counters fold by their aggregate: `'sum'` adds, `'max'` keeps the larger.
- `day` is the event's own day (captured when it started), never the clock read at write time.
- The fold never mutates its input and never reads a clock (`fold-immutable`, `wall-clock`).

## Custom counters

```ts
type CounterSpec<TStep> = { id: string; aggregate: 'sum' | 'max'; measure: (step: TStep) => number };
measureCounters(specs, steps)   // per counter: 'sum' of the per-step values, or their 'max' (0 without steps)
type CounterValue = { value: number; aggregate: 'sum' | 'max' };   // what an event carries per counter
```

- **The id is a stored key**: kebab-case (`subtasks-completed`), stable forever. Renaming it orphans
  the stored total; a rename is a data migration (persistence-and-migrations), never an edit.
- **`'sum'` is a running total** ("Subtasks completed: 42"); **`'max'` is a best single event**
  ("Longest checklist: 12"). Pick per counter; the screen formats them differently.
- **Two levels fold by the aggregate.** `measureCounters` folds the steps of ONE event (`'max'` keeps the
  largest single step: "longest word in a game"); `recordActivity` folds events (`'max'` keeps the best
  event). A record of an event's size ("Longest checklist") is not a per-step value: the caller measures
  it once per event and passes `{ value: task.subtasks.length, aggregate: 'max' }` next to the
  measured counters (examples/complete-task.ts). A spec with `aggregate: 'max', measure: () => 1` reads 1
  for every event: the largest single step of a checklist is one step.
- **Measure the final committed log.** An activity with undo (an editor, a game) measures its steps
  after the last undo, so undone steps never count; a kill mid-activity loses nothing when the log is
  persisted (state-management-zustand's undoable session).

## The completion write: one fold, one transaction, then publish

```ts
// src/core/stats/record-completion.ts (pure; template)
type ActivityProgress<TDay> = { streak: DayStreak<TDay>; stats: ActivityStats };
type Completion<TDay> = { day: DateKey; dayResult: TDay; event: ActivityEvent; isPractice: boolean };
recordCompletion(progress, completion): ActivityProgress<TDay>
```

| Case | Result |
|---|---|
| `isPractice` (a sample, a tutorial, a replay of a scored day) | `progress` itself: nothing to write |
| the first completion of `day` | the streak records the day, the statistics count the event, both under `day` |
| another completion on an active day | the streak section is the same object; the statistics count it |

`record-completion.ts` is the one statistics file that imports `src/core/streaks/`: copy it only when
the app has both folders. An app with statistics and no streaks sets `"recordCompletion": null` in the
contract and folds with `recordActivity(stats, event, day)` in its handler (the same one transaction);
the contract refuses `recordCompletion` (or `statsSummary`) when a module it needs is `null`.

The caller (a model hook handler or a service) then writes the completed row and the new progress in
**one transaction**, before the confirmation (a checkmark animation, a result screen) appears, and
only then publishes to the stores:

```ts
const today = clock.today();                                  // read inside the handler
const { progress } = stores.progress.getState();              // current state, read inside too
const next = recordCompletion(progress, completionOf(task, today));
updateAndPublish(stores, () => tasks.complete({ taskId, completedAtMs: clock.nowMs(), progress: next }));
```

- The fold starts from the current state read in the handler (`stores.progress.getState()`, or the
  stored row read inside the repository transaction), never from a value captured at render: two
  checkboxes tapped in one frame, or a "complete all" loop, would otherwise both fold from the same
  stale progress, and the second write would erase the first one's day and counts.
- One transaction (persistence-and-migrations' rule: a write of two statements is one transaction): a
  kill between the task row and the progress row would leave a done task without its streak day.
- Persist before publish (state-management-zustand): the stores re-read after the commit, so the Today
  card, the streak and the statistics screen never show numbers that are not on disk.
- Before the confirmation: a user who sees "5 days in a row!" and force-quits keeps the 5 days.
- `examples/complete-task.ts` shows the repository method and the handler for a Tasks app.

## The statistics summary

```ts
// src/core/stats/stats-summary.ts (pure; template)
buildStatsSummary({ stats, streak /* { activeDays, current, best } or null */, today, counterIds }): {
  isEmpty,                                                   // total === 0
  overview: { total, successes, successRate /* 0..1 */, duration: { hours, minutes } },
  runs: { current, longest },
  bestDay,                                                   // or null before the first event
  streak: { activeDays, current, best } | null,
  week: { bars: [{ date, weekday /* ISO */, count }] /* 7, oldest first */, max /* >= 1 */ },
  counters: [{ id, value }]                                  // in counterIds order, 0 when absent
}
splitDuration(ms)    // 8,040,000 -> { hours: 2, minutes: 14 }
rateOf(part, whole)  // 0 when whole is 0, never NaN
```

- Every number a screen shows comes from here; the screen and its model hook only format
  (`day-maths-in-ui`). The `streak` input is the three counts, built with `streakCountsOf(log, today)`
  from the streak summary module (active days and the best streak from the stored counters, never the
  pruned window); the statistics folder never imports the streaks folder, so an app without streaks
  passes `null` and copies only `src/core/stats/`.
- `week.max` is at least 1, so a week of zeros never divides by zero; a bar's height is
  `count / max` of the chart height. The row mirrors in right-to-left layouts.
- The model hook reads `useToday()`, the two sections through selectors that return section references
  (no `useShallow` needed), and rebuilds the summary on each render (it is cheap; the React Compiler
  memoizes what it can, so no hand-written `useMemo`).
- `examples/stats-cells.ts` maps the summary onto cells with testIDs, label keys and value kinds.

## Formatting at the edge

- The rate is a 0..1 fraction; the view shows the bare percentage ("75%") with the i18n layer's
  percent formatter in the locale's digits, under its label. A sentence like "On time 75% of the time"
  is a different message.
- Durations: a message with `{hours}` and `{minutes}` ("2 h 14 min"), plural-aware, translated in full.
- Dates on cards ("Best day: 12 on 26 Sep"): `formatDayMonth(date, t)` from `src/i18n/format-date.ts`.
- Weekday letters and names: from the ISO weekday through the catalogs.
- i18n-strings-and-catalogs owns every formatter; the summary holds plain numbers and keys only.

## The empty state and "Reset statistics"

- `summary.isEmpty` switches the screen to an empty state ("Complete a task to see your statistics
  here") with one clear action; a new user never sees a wall of zeros (ui-states-and-feedback).
- "Reset statistics" asks first (a destructive action), then writes `EMPTY_ACTIVITY_STATS` in one
  transaction, with the backup refreshed, so a later restore cannot bring the numbers back
  (data-export-and-restore). Decide with the developer whether it also resets the streak: the two are
  separate sections on purpose. Settings are never touched by a reset (settings-and-preferences).
- Right after a reset `total` is 0, so the empty state shows again.

## Mapping for a Tasks app

| Field | Tasks app |
|---|---|
| event | a task completed (an undo of the completion is a separate, explicit "reopen" with its own rule) |
| `isSuccess` | completed on or before its due day (`today <= task.dueOn`; a task with no due day counts as on time) |
| `durationMs` | focus time tracked on the task, or 0 |
| `currentRun` / `longestRun` | consecutive on-time completions |
| `perDay` | tasks completed per day, for the seven-day chart |
| `bestDay` | the most tasks completed in one day |
| counters | `subtasks-completed` (`'sum'` of the done subtasks, via `measureCounters`), `longest-checklist` (`'max'` of the checklist size, measured once per task by the caller) |

## What the checker runs

| Rule | What it proves on the app's module |
|---|---|
| `stats-counts` | totals, successes, failures and time add up |
| `stats-run` | a failure resets the run; the longest is kept |
| `stats-best` | the best day survives its bucket's pruning; a tie keeps the earlier day |
| `stats-days` | buckets cover exactly `STATS_KEEP_DAYS` days back from the newest; an older event still counts |
| `stats-counters` | `'sum'`/`'max'` folds; `measureCounters` over committed steps, 0 without steps |
| `fold-immutable` | `recordActivity` and `recordCompletion` never change a frozen input |
| `view-stats` | empty state, rate with a zero guard, duration split, seven bars oldest first with ISO weekdays and `max >= 1`, counters in order, the given streak counts passed through unchanged (or `null`) |
| `completion-record` | practice records nothing; the first completion records both sections under its own day; a repeat on an active day counts in the statistics and leaves the streak untouched |
