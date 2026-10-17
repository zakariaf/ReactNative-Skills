# Streaks

The rules users check by hand ("I did it yesterday, why is my streak 0?"), written once as a pure model
on civil-date keys and proven by `scripts/check-streaks-and-stats.mjs` against the app's own module.

## Contents

- The rules
- The stored section and its API
- Why the counts are stored incrementally
- One source of truth: stored or derived
- A clock set back, travel and the kept window
- What counts as an active day (the app decides)
- Grace, freezes and repair are product data
- The streak summary and the week strip
- Profile: a daily challenge (games and daily content)
- Mapping for a Tasks app
- What the checker runs

## The rules

1. **One entry per active day; the first event of the day counts.** More events that day change
   nothing in the streak section (`recordDay` returns the same object, so no write and no render).
2. **The streak is "active yesterday or today".** It continues while the last active day is today or
   yesterday; it shows the stored length until the end of the day after the last active day; after a
   missed day it shows 0 and the next active day starts a new streak at 1.
3. **The best streak is kept** as a stored maximum.
4. **A clock set back never removes a done day and never counts one twice.** An earlier day is recorded
   (it was active) but leaves the streak unchanged; while today is before the last active day the
   streak keeps showing.
5. **An event belongs to the day it started**, captured when it started and passed in.
6. **Pruning never shortens a count.** Per-day detail is kept for a window; the streak, the best streak
   and the number of active days are stored counters.

## The stored section and its API

```ts
// src/core/streaks/day-streak.ts (pure; template)
type DayStreak<TDay> = {
  byDay: Record<DateKey, TDay>;                 // first result of each day, last 60 days before the newest
  activeDays: number;                           // every day ever recorded
  streak: { lastDate: DateKey | null; length: number };
  bestStreak: number;
};
EMPTY_DAY_STREAK                                // a new user (frozen; assignable to any DayStreak<TDay>)
DAY_STREAK_KEEP_DAYS = 60
recordDay(log, date, day)                       // rules 1, 3, 4, 6; throws RangeError for a non-day key
currentStreak(log, today)                       // rule 2 (and 4: today before lastDate keeps it)
isDayDone(log, today)
recentDays(log, today, count)                   // [{ date, isDone }] oldest first, ending with today
streakOfDays(days)                              // derived from a full history (any order, repeats)
```

The field names are part of the contract the checker reads (it builds inputs in this shape). `TDay`
is what the app keeps for a day: `{ firstTaskId }` in a Tasks app, a score for a daily puzzle, `true`
for a check-in. Keep it small; it is stored for 60 days.

`recordDay` in detail:

| Case | Result |
|---|---|
| `date` already in `byDay` | `log` itself (a repeat) |
| `date` 60 or more days before `streak.lastDate` | `log` itself (it may have been counted and pruned) |
| first day ever | `{ lastDate: date, length: 1 }` |
| gap of 1 day after `lastDate` | `length + 1` |
| gap of 2 or more | a new streak of 1 |
| gap of 0 or less (clock set back) | streak unchanged; the day is recorded and counted |
| always on a write | `activeDays + 1`, `bestStreak = max`, `byDay` pruned to the window before the newest day |

## Why the counts are stored incrementally

A user with a 400-day streak has 400 active days, but `byDay` keeps 60. Counting `Object.keys(byDay)`
for "Days active" stops at 60, and recomputing the streak from `byDay` caps it at 60. So the streak,
the best streak and `activeDays` are counters updated by the same fold that records the day. The same
applies whenever detail can disappear for any reason: a pruned window, a user who deletes completed
tasks ("Clear completed"), a history capped for size.

## One source of truth: stored or derived

Every number has exactly one source:

- **Derived on read** when the app keeps the full history forever (a completions table nobody
  deletes from): `streakOfDays(daysFromTheTable)` gives `{ activeDays, streak, bestStreak }`. Do not
  also store a streak: two sources drift, and a later sync must reconcile both.
- **Stored incrementally** when the detail is pruned, capped or deletable: the section above, updated
  in the same transaction as the event (statistics reference, "The completion write").

`streakOfDays` exists in both cases: it is how a migration or a "recompute from history" support tool
rebuilds the section, and the checker proves it agrees with `recordDay` over the same days in order
(`streak-derive`). The derived and stored forms differ only for days recorded out of order (a clock
set back), where the stored form deliberately never re-extends an old streak.

## A clock set back, travel and the kept window

- Clock set back by one day after an active today: the earlier key is recorded once, the streak and
  `lastDate` stay, and `currentStreak` keeps showing the streak (today is before `lastDate`).
- A key older than the kept window cannot be checked against `byDay` (it may have been pruned after
  being counted), so `recordDay` ignores it rather than counting it twice.
- Travel west repeats a calendar day (handled as above); travel east over the date line can skip one,
  which ends the streak by the plain rule (next section for grace).
- **Clock set forward, then corrected** (a "time travel" trick, or a wrong date set by hand). One event
  on a future day F sets `lastDate = F` and prunes `byDay` relative to F. After the clock is put back,
  real days less than 60 days before F are recorded and counted in `activeDays` but never extend the
  streak (they are not after `lastDate`), and real days 60 or more days before F are ignored entirely,
  so `activeDays` misses them too. The user sees a frozen streak until real time passes F. This is a
  deliberate trade-off: the rules still hold (no done day removed, none counted twice), and any rule
  that let a later event "undo" F would let a clock set back erase real days. The remedies: a support
  or migration tool that rebuilds the section with `streakOfDays` from the kept history (the
  completions table) and writes it in one transaction; and, when the app has a trusted server time,
  refusing an event dated more than one day after it. `day-streak.test.ts` pins this behaviour, so a
  change to it is a deliberate decision.

## What counts as an active day (the app decides)

The model records whatever the caller passes. The caller decides what qualifies, once, in feature
logic: in a Tasks app, completing a real task (the onboarding sample task never counts, `isPractice`);
for a daily puzzle, the first finished attempt, won or lost. Write it down in the feature's spec and
test it; a qualifying rule that hides inside a component drifts.

## Grace, freezes and repair are product data

The plain rule has no streak insurance. If the product adds a freeze ("one free missed day a week") or
a paid repair, it is a decision for the developer, and its effect is data: the freeze is recorded as a
day (a `TDay` such as `{ kind: 'freeze' }`) through the same `recordDay`, so the streak rule, the
checker and every screen stay the same. Never add an `if (hasFreeze)` branch inside `currentStreak`.

## The streak summary and the week strip

```ts
// src/core/streaks/streak-summary.ts (pure; template)
buildStreakSummary(log, today): {
  today, isDone, todayResult /* TDay | null */, currentStreak, bestStreak, activeDays,
  week: [{ date, weekday /* ISO 1..7 */, mark: 'done' | 'missed' | 'today', isToday }] // 7, oldest first
}
streakCountsOf(log, today): { activeDays, current, best }  // buildStatsSummary's `streak` input
```

The "New day in 3 h 5 min" line is not part of this module: `useNextDayCountdown()` returns it from
`src/core/countdown/split-countdown.ts` (calendar-days reference), so an app without streaks has it too.

- Marks: `done` for a recorded day (today included once done), `today` for an unplayed today, `missed`
  otherwise.
- The strip is a row (`flexDirection: 'row'`), so a right-to-left layout mirrors it with no extra code
  (rtl-and-direction); never reverse the array for RTL.
- Each cell's letter and screen-reader name come from its ISO weekday through the i18n layer
  (`formatWeekdayName(day.date, t)`), so column 1 on a Saturday reads "Sunday". Give each cell an
  accessible name ("Saturday, done") for VoiceOver and TalkBack (accessibility-as-code); the mark is
  never colour alone.
- Number the cells by position (`<screen>.week-day.1` is six days ago, `.7` is today) so E2E flows can
  find them (naming-conventions owns testIDs).
- A new user sees the streak at 0 with an encouraging empty state, not a wall of zeros.
- Name the pure module `…-summary.ts`: the screen files of the same feature are `<feature>-screen.tsx`
  and `use-<feature>-model.ts`, and the summary must not be mistaken for either.

## Profile: a daily challenge (games and daily content)

A daily puzzle, a daily focus task picked by seed, or a daily quiz uses the same model with one extra
rule: **the first finished attempt of the day is the day's result, won or lost; a replay changes
nothing.** Mark the replay `isPractice: true` at the call site (statistics reference) and nothing is
recorded. The content of the day comes from the key: seeded-determinism-and-golden-vectors owns the
seed, its goldens and versioned cutovers; level-generation-and-solvers owns a generated daily level.
A past day cannot be replayed for the streak: only the run's own start day is ever recorded.
When the game records every attempt (game-session-host writes one `game_run_ends` row per run, with
`day` = the day the run started, and has no practice flag), apply this profile where the statistics are
built: per daily day, the earliest finished row is the completion and later rows are passed as
`isPractice: true`.

## Mapping for a Tasks app

| Concept | Tasks app |
|---|---|
| active day | a day with at least one real task completed |
| `TDay` | `{ firstTaskId: number }` |
| practice | the onboarding sample task |
| streak card | "5 days in a row" on the Today screen, the week strip, "New day in 3 h 5 min" once today is done |
| days active | `activeDays` on the statistics screen |

## What the checker runs

| Rule | What it proves on the app's module |
|---|---|
| `streak-first-of-day` | a repeat returns the same object; the first result is kept; the day counts once |
| `streak-rule` | 3 consecutive days give 3; yesterday still counts; a missed day gives 0; a gap restarts at 1; the best is kept |
| `streak-clock-back` (`recordDay`) | an earlier day leaves the streak, keeps the later day done, is counted once and never twice; a key older than the window is ignored |
| `streak-clock-back` (`currentStreak`) | the streak keeps showing while today is before `lastDate` (two days and weeks before) |
| `streak-prune` | `byDay` keeps exactly `DAY_STREAK_KEEP_DAYS`; the streak and `activeDays` survive pruning |
| `streak-week` | `recentDays` runs oldest first and ends with today |
| `streak-derive` | `streakOfDays` (when exported) agrees with `recordDay` over the same days, across a year end and a leap day |
| `fold-immutable` | `recordDay` never changes a frozen input |
| `view-streak` | ISO weekdays, marks, `todayResult`, and counts taken from the stored section; `streakCountsOf` (when exported) reads `activeDays` and the best streak from the counters and shows 0 after a missed day |

The countdown (`view-countdown`) is checked by check-calendar-code with the day hooks.
