# The two checkers

Both are zero-dependency Node scripts (Node 22.18 or newer: they import the app's TypeScript through
Node's type stripping). Run them from the app repo root; the root is an optional positional argument.
Exit 0 pass (SKIP and NOT APPLICABLE included), 1 problems, 2 bad input; the last line is always
`RESULT: PASS` or `RESULT: FAIL (<n> problems)`.

## Contents

- check-calendar-code.mjs
- check-streaks-and-stats.mjs
- The contract: contracts/day-logic.json
- Layout and options
- Expected SKIP and NOT APPLICABLE lines
- When multi-package
- Troubleshooting

## check-calendar-code.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-calendar-code.mjs . [--src-dir <dir>] [--contract <file>] [--json]
```

Scans every runtime `.ts`/`.tsx` file under `src/` (tests, `__mocks__/`, `test/`, `.d.ts` and installed
skills are left out), then checks the clock, the day hooks, the date-key module and the countdown module.

| Rule | Scope | Reports |
|---|---|---|
| `utc-day` | all of `src/` | `toISOString().slice(0, 10)`, `.substring(0, 10)`, `.split('T')[0]`, `toJSON().slice(0, 10)`, `getUTCFullYear/Month/Date/Day()` |
| `date-only-parse` | all of `src/` | `new Date('YYYY-MM-DD')` or `Date.parse('YYYY-MM-DD')` with a literal, and `new Date(x)` or `Date.parse(x)` with one argument whose last name segment reads like a DateKey: `today`, `day`, `dateKey`, a camelCase name ending in `On`, `Key` or `Day` (`dueOn`, `task.dueOn`, `dayKey`, `lastActiveDay`), or a snake_case one ending in `_on`, `_key` or `_day`; names ending in `OfDay` (`startOfDay`) are left alone |
| `day-ms-arithmetic` | `src/` outside `src/services/clock/` | `/`, `%` or `/=` by a whole number of days of milliseconds: a literal (`86_400_000`, `864e5`, `8.64e7`), a numeric product in any order (`(1000 * 60 * 60 * 24)`, `(1000 * 3600 * 24 * 7)`), a chain of divisors (`/ 1000 / 60 / 60 / 24`), a well-known name (`DAY_MS`, `MS_PER_DAY`, `ONE_DAY_MS`, ...), or a constant the same file, or any scanned file's `export const`, sets to such a number (`const ONE_DAY = 24 * 60 * 60 * 1000`) |
| `local-day-key` | `src/` outside `src/services/clock/` and `src/i18n/` | one file calling all of `getFullYear()`, `getMonth()` and `getDate()`: a day key built by hand |
| `today-cached` | all of `src/` | `useState/useRef/useMemo(… today())` with or without a type argument (`useState<DateKey>(clock.today())`), the lazy initializer `useState(clock.today)` (a function reference: React calls it once), `useEffect(() => { setX(… today()) })`, a module-level `const x = … today()` |
| `wall-clock` | day code: `src/core/**`, the two day hooks, `src/**/*-summary.ts`, contract modules and `dayCode` | `Date.now`, `new Date`, `Date.parse`, `Math.random`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `toLocale*String`, `getTimezoneOffset`; `new Date(<one value>).toISOString()` is allowed (an epoch ms to ISO 8601 UTC text reads no clock and no zone), while `new Date()`, several arguments or a local getter (`new Date(atMs).getHours()`) count |
| `day-maths-in-ui` | every `.tsx` and `use-*.ts` under `src/` except the day hooks, plus contract `uiCode` | `addDays/daysBetween/dayNumber/fromDayNumber()`, `.streak.length`, `.streak.lastDate`, `.byDay`, `.perDay`, `msUntilNextLocalDay()`, `86_400_000` |
| `today-hook` | `src/hooks/use-today.ts`, `src/hooks/use-next-day-countdown.ts` when present | no timer (`setTimeout`/`setInterval`), or no `AppState` subscription |
| `clock-countdown` | `src/services/clock/clock-port.ts`, every `*-adapter.ts` there, `fake-clock.ts` | no `msUntilNextLocalDay` (the port must declare `msUntilNextLocalDay: () => number`) |
| `date-math` | `src/core/dates/date-key.ts` | a pinned fact (day numbers, leap years 2000/2028/2100, a 23-hour day, ISO weekdays, malformed keys, `isDateKey`) or the 1900-2400 round trip against `Date.UTC` |
| `view-countdown` | `src/core/countdown/split-countdown.ts`, required once `src/hooks/use-next-day-countdown.ts` exists | `splitCountdown` gets a pinned value wrong: 3 h 5 min, the last 30 s read 1 min, a part minute rounds up, 25 h on the long day, 0 at midnight |
| `module-load` | `date-key.ts` and `split-countdown.ts` | it cannot be imported as pure TypeScript |

**The marker.** `// not-a-calendar-day: <why>` on the line or the line above exempts that line from
`utc-day`, `date-only-parse`, `local-day-key` and `day-ms-arithmetic`: a UTC date a server API asks for, a 24-hour cache lifetime. The
reason is for the reviewer; a marker without one is a review comment.

Lint overlaps on purpose: the canonical ESLint config already bans `Date.now()`, `new Date()` with no
argument, `Intl.DateTimeFormat` outside `src/i18n/` and `toLocale*String` in app code. The checker adds
what lint cannot see (a UTC day from `new Date(ms)`, a key parsed as UTC midnight, a day key built from a `Date` passed in, a day count from
milliseconds, a cached today, day maths in a component) and still works in an app whose lint config differs.

## check-streaks-and-stats.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-streaks-and-stats.mjs . [--contract <file>] [--json]
```

Imports each module and runs the rules of the streaks and statistics references on it (their "What the
checker runs" tables). A check needs only the module it names: inputs are built as plain objects in the
stored shape, so a broken `day-streak.ts` does not fail the statistics checks.

| Module key | Default path | Exports the checks call |
|---|---|---|
| `dayStreak` | `src/core/streaks/day-streak.ts` | `recordDay`, `currentStreak`, `isDayDone`, `recentDays`, `DAY_STREAK_KEEP_DAYS`, optional `streakOfDays` |
| `streakSummary` | `src/core/streaks/streak-summary.ts` | `buildStreakSummary`, optional `streakCountsOf` |
| `activityStats` | `src/core/stats/activity-stats.ts` | `recordActivity`, `measureCounters`, `STATS_KEEP_DAYS` |
| `statsSummary` | `src/core/stats/stats-summary.ts` | `buildStatsSummary` (takes the streak counts, never the streak section) |
| `recordCompletion` | `src/core/stats/record-completion.ts` | `recordCompletion` (needs `dayStreak` and `activityStats`) |

Rules: `missing-module`, `module-load`, `streak-first-of-day`, `streak-rule`, `streak-clock-back`,
`streak-prune`, `streak-week`, `streak-derive`, `view-streak`, `stats-counts`, `stats-run`,
`stats-best`, `stats-days`, `stats-counters`, `view-stats`, `completion-record`, `fold-immutable`. A
rule that covers two functions (`streak-rule`, `streak-clock-back`, `view-streak`, `fold-immutable`)
runs one check per function, so the problem line names the function and line that broke it. The
countdown (`view-countdown`) moved to check-calendar-code with the day hooks: an app with a countdown
and no streaks still has it checked.

A module that imports React, React Native, Expo or an app layer cannot load in plain Node; that is the
purity these rules need (`module-load`). Types and other pure modules (`@/core/...`) load fine; the
tsconfig `paths` aliases resolve.

## The contract: contracts/day-logic.json

```json
{
  "$schema": "./day-logic.schema.json",
  "modules": {
    "dayStreak": "src/core/streaks/day-streak.ts",
    "streakSummary": "src/core/streaks/streak-summary.ts",
    "activityStats": "src/core/stats/activity-stats.ts",
    "statsSummary": "src/core/stats/stats-summary.ts",
    "recordCompletion": "src/core/stats/record-completion.ts"
  },
  "dayCode": [],
  "uiCode": []
}
```

- Every module named is required (`missing-module` when the file is absent); `null` says the app has
  no such module (an app with streaks but no statistics sets the three statistics keys to `null`; an
  app with statistics but no streaks sets `dayStreak`, `streakSummary` and `recordCompletion` to
  `null`; an app with only "today" and the countdown sets all five to `null`).
- The templates import each other in one direction only: `streakSummary` needs `dayStreak`,
  `statsSummary` needs `activityStats`, and `recordCompletion` needs both `dayStreak` and
  `activityStats`. A contract that names a module but sets one it needs to `null` describes code that
  cannot compile, so it is bad input (exit 2, naming the dependency). The hooks need only the clock,
  `date-key.ts` and `src/core/countdown/`.
- `dayCode`: more globs that must receive time as values (a feature's pure logic that works on days).
- `uiCode`: more globs that only format (for example a `*-view.ts` helper next to components).
- Unknown keys, a missing module key or a path that is not a repo-relative `.ts` file is bad input
  (exit 2). The schema is `templates/contracts/day-logic.schema.json`.
- Without the file, the default paths are used: required as soon as one of them exists.

## Layout and options

- `resolveLayout` from the shared check-lib: `src/` and the `@/*` alias by default; `rn-skills.config.json`
  at the repo root may move folders (`"srcDir"`, `"coreDir"`, `"servicesDir"`, `"contractsDir"`).
- `"dayLogicContract"` in `rn-skills.config.json` moves the contract; `--contract <file>` overrides it.
- `--src-dir <dir>` (calendar checker) overrides the source folder for one run.

## Expected SKIP and NOT APPLICABLE lines

| Line | When |
|---|---|
| `SKIP src/services/clock/clock-port.ts [clock-countdown] not yet created (architecture-and-boundaries creates it)` | the app has no clock port yet |
| `SKIP src/core/dates/date-key.ts [date-math] not yet created (seeded-determinism-and-golden-vectors creates it)` | the app has no date keys yet |
| `NOT APPLICABLE: no streak or statistics module: contracts/day-logic.json is absent and none of ... exists` | an app with no streaks or statistics |
| `NOT APPLICABLE: contracts/day-logic.json sets every module to null` | the same, said explicitly |

This skill ships both missing files as synced templates: copying them turns the SKIP lines into checks.

## When multi-package

Run each checker once per app, with the app folder as the root (its `src/`, `contracts/` and
`tsconfig.json` paths); workspace packages the app imports by name resolve through `package.json`
`workspaces`. When the day logic lives in a shared pure package, run check-streaks-and-stats on the
package folder too, with its own `contracts/day-logic.json` naming its files (contract paths never
leave the folder they are read from).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `module-load ... it imports react-native` | a model or summary imports a UI or platform module; move the import to the hook and keep the module pure |
| `module-load ... it imports @/core/dates/date-key (...), which does not exist` | a module the file imports is missing: create it (the message names the skill that does) or fix the import path |
| `module-load ... Cannot find module '@/...'` | the repo's `tsconfig.json` has no `paths` for `@/*`, or the file moved; fix the alias |
| `missing-module` for a module the app does not want | set it to `null` in `contracts/day-logic.json` |
| `day-ms-arithmetic` on a cache lifetime | add `// not-a-calendar-day: <why>` above the line |
| `nowMs + 86_400_000` or `completedAtMs > nowMs - 86_400_000` passes | adding or subtracting a day of milliseconds is a **review item, not checked**: legitimate 24-hour lifetimes (a cache, a rate limit, a token) make that form too noisy for a scan. Review it by hand with the table in calendar-days.md ("Counting days and durations") |
| a day count still passes | the scan is lexical, so it misses a day built from other names (`24 * HOUR_MS`, `/ MS_PER_HOUR / 24`), a constant imported from a package outside `src/`, seconds (`/ 86_400`) and a day held in an object field (`UNITS.day`). Review those by hand; prefer `daysBetween()` over adding names to the scan |
| `ERROR [bad-input] nothing to check` from check-streaks-and-stats | the root has no `src/` (wrong working directory, or not an app); pass the app folder. NOT APPLICABLE is printed only for an app that has no streak or statistics module |
| `ERROR ... "modules.recordCompletion" is set but "modules.dayStreak" is null` | the app has statistics and no streaks: set `"recordCompletion": null` and fold with `recordActivity()` in the handler, or copy the streaks folder |
| `view-countdown ... no pure countdown module` | copy `templates/src/core/countdown/` (the hook imports it); it does not depend on streaks |
| `today-cached` misses a day kept in state | the scan is lexical: it catches `today()` and `<x>.today` passed to `useState`/`useRef`/`useMemo`, but deliberately not a bare variable (`useState(today)` is also the normal initial value of a date picker), nor a day passed through another name or a custom hook. Review those by hand |
| `date-only-parse` on a picker value | seed the picker with `localNoonOfDateKey(key)` and read it back with `dateKeyOfLocalDate(date)` (`src/services/clock/local-date.ts`; calendar-days.md, "Converting at the edges") |
| a date-only parse still passes | the scan judges one bare argument by its name, so it misses a key under a neutral name (`new Date(value)`, `new Date(key)`, `new Date(date)`; `date` is left out because copying a `Date` is common), a lowercase compound (`birthday`), an expression (`new Date(task.dueOn ?? fallback)`, a template literal) and a library parse. Review those by hand; `parseISO` (date-fns) and `dayjs(key)` read a date-only string as local time and are fine |
| `today-cached` in a test helper | tests are not scanned; the file is runtime code under `src/`: move the helper to `test/` |
| `streak-derive` fails after an edit | `streakOfDays` must de-duplicate and sort before folding with the same rule as `recordDay` |
| Node prints `cannot strip TypeScript types` | Node older than 22.18: use the Node version the app pins in `.nvmrc` or `engines` (22.18 or newer; the canonical stack uses Node 26) |
