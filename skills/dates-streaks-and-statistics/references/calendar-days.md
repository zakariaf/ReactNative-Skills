# Calendar days: keys, the clock, midnight, DST and time zones

How an Expo app knows what day it is, when that day ends, and how to count days without being wrong
for some users every day. `scripts/check-calendar-code.mjs` enforces the rules here on the app's code.

## Contents

- One day definition: the local civil-date key
- The clock port and its one adapter
- Reading "today": useToday
- Local midnight, DST and midnights that do not exist
- Time zones, travel and a clock set back
- Converting at the edges: pickers and servers
- The countdown to the next day
- Counting days and durations
- Formatting dates (hand-off) and the calendar caveat
- iOS and Android behaviour
- Testing calendar code
- Device probes
- Appendix: React Navigation 7 (static API)

## One day definition: the local civil-date key

A day is a `DateKey`: the user's local calendar date as `'YYYY-MM-DD'`, from `clock.today()`. It is
an identity ("the 26th of September for this user"), never an instant. All arithmetic on keys is
integer maths in `src/core/dates/date-key.ts` (Howard Hinnant's `days_from_civil` /
`civil_from_days`; seeded-determinism-and-golden-vectors owns the module and its goldens, this skill
ships a synced copy):

| Function | Meaning |
|---|---|
| `dayNumber(key)` | days since 1970-01-01; `NaN` unless the key has the `YYYY-MM-DD` shape |
| `fromDayNumber(days)` | the inverse |
| `isDateKey(text)` | true only for a real calendar day (`'2026-02-30'` is false) |
| `addDays(key, n)` · `daysBetween(a, b)` | calendar arithmetic; a 23- or 25-hour day is still one day |
| `isoWeekday(key)` | 1 = Monday ... 7 = Sunday |

Keys with four-digit years compare correctly as strings (`'2026-09-25' < '2026-09-26'`), so "due on
or before" is `today <= dueOn`. Validate any key that comes from storage, a deep link or a server with
`isDateKey` before using it: `dayNumber('2026-02-30')` quietly returns March 2nd's number.

Why not an instant or the UTC day: `new Date().toISOString().slice(0, 10)` is the date in London. In
Tehran (UTC+03:30) it is still "yesterday" until 03:30; in Los Angeles it is already "tomorrow" from
17:00. A developer near UTC never sees it; users far from UTC see a wrong streak, a wrong "due today"
list and a wrong daily item every day (`utc-day`). Building the key by hand from a `Date`'s local
getters (`getFullYear()`, `getMonth() + 1`, `getDate()`) gets the zone right but makes a second day
source that the fake clock cannot drive; only the system adapter does that (`local-day-key`).

## The clock port and its one adapter

```ts
// src/services/clock/clock-port.ts (architecture-and-boundaries owns it; synced here)
export type ClockPort = {
  readonly nowMs: () => number;               // epoch ms: timestamps, durations, rate limits
  readonly today: () => DateKey;              // local 'YYYY-MM-DD'; changes at local midnight
  readonly msUntilNextLocalDay: () => number; // 1 .. one local day (up to 25 h when clocks fall back)
};
```

- `system-clock-adapter.ts` is the one app file that reads the wall clock (the lint config exempts exactly
  `src/services/clock/*-adapter.ts`). `today()` uses the local `getFullYear/getMonth/getDate`,
  zero-padded; `msUntilNextLocalDay()` is `new Date(y, m, d + 1) - now`.
- `fake-clock.ts` keeps the three values consistent: `advance(ms)` moves time and rolls `today()` over
  at midnight, a negative `advance` is the phone clock going back, and `setToday(day)` jumps days
  (streak tests, a debug set-date tool). Its days are 24 h long; DST behaviour is the adapter's test.
- Code receives the port from `useServices()` (hooks and model hooks) or as a factory argument
  (services, stores). Pure code (`src/core`, reducers, summaries) receives values: a `DateKey` and, when
  it needs one, an epoch ms number. That is what makes every rule here a millisecond Jest test
  (`wall-clock`).
- A test build may wrap the port so a debug menu can set the date (debug-menu-and-test-hooks owns the
  simulated clock). It changes `today()` only and keeps `nowMs()` and `msUntilNextLocalDay()` real.

## Reading "today": useToday

```ts
const today = useToday(); // src/hooks/use-today.ts
```

The hook reads `clock.today()` on every render through `useSyncExternalStore`, and subscribes to two
things that can change the answer while nothing else re-renders the screen:

1. **Local midnight.** A timer armed from `msUntilNextLocalDay()`, capped at `TODAY_RECHECK_MS`
   (60 s) and re-armed each time. A Tasks app left open on a kitchen tablet turns its "Today" list at
   00:00, and a clock or time zone changed by hand while the app is open is noticed within a minute.
2. **AppState changes.** Timers do not run while the app is suspended; on return to the foreground
   the hook reads the day again (the morning after, the list shows the new day at once).

Never keep today in `useState`, `useRef`, `useMemo`, a module constant or state an effect fills once
(`useEffect(() => setDay(clock.today()), [])`), and never compute it once in
a parent and pass it down a long way (`today-cached`). A handler reads `clock.today()` again when it
runs: a button pressed one minute after midnight belongs to the new day even if the screen has not
re-rendered yet.

Screen focus is not needed for correctness: the two subscriptions already cover the day turning while
a screen is hidden in a stack (it re-rendered at midnight). Use Expo Router's `useFocusEffect` for
work that must restart on focus, not for the day.

## Local midnight, DST and midnights that do not exist

- A local day is 23, 24 or 25 hours long. Europe/Berlin had a 23-hour day on 2026-03-29 and a 25-hour
  day on 2026-10-25; Australia/Lord_Howe shifts by 30 minutes (a 23.5-hour day on 2026-10-04).
- In some zones the clocks jump at midnight, so 00:00 does not exist that day: America/Havana
  (2026-03-08), America/Santiago (DST starts at 24:00, 2026-09-06), and Brazil until 2019
  (America/Sao_Paulo, 2018-11-04). The Date constructor moves a nonexistent local time forward, so
  `new Date(y, m, d + 1)` lands on 01:00, which is exactly when the local date changes.
- Verified on 2026-10-03 with Node 26.4 (V8 and ICU time-zone data) for every zone above plus
  Asia/Tehran, Pacific/Chatham and America/Los_Angeles: `today()` is unchanged 1 ms before the
  countdown ends and is the next day when it ends, and the next countdown is the next day's length.
  Hermes on iOS and Android implements the same ECMAScript local-time rules over the OS time-zone data;
  that device behaviour was not re-run here. Re-verify the Node side (prints when each day starts and
  how long it lasts; Havana and Santiago start at 01:00):

  ```sh
  for p in Europe/Berlin:2026-03-29 Europe/Berlin:2026-10-25 America/Havana:2026-03-08 America/Santiago:2026-09-06 Australia/Lord_Howe:2026-10-04; do
    TZ=${p%%:*} node -e 'const [y,m,d]=process.argv[1].split("-").map(Number);const s=new Date(y,m-1,d);console.log(process.env.TZ,process.argv[1],s.toTimeString().slice(0,5),(new Date(y,m-1,d+1)-s)/36e5,"h")' ${p#*:}
  done
  ```

## Time zones, travel and a clock set back

- **The key follows the user.** A traveller's day is the day where they are. Flying west (Tokyo to Los
  Angeles) the local date can go back one day: `today()` returns a key that is earlier than the last
  active day. Flying east over the date line it can skip a day.
- **The clock set back** (by hand, or a phone that lost its network time) looks the same as flying
  west. The streak rules (streaks reference) keep every done day, never count a day twice and keep
  showing the streak while today is before the last active day.
- **The clock set forward, then corrected** records one event on a future day; the streak then stays
  frozen until real time passes that day (a deliberate trade-off; the streaks reference, "A clock set
  back, travel and the kept window", gives what the user sees and the repair with `streakOfDays`).
- **A skipped day breaks a streak**, by the plain rule. Whether a traveller deserves grace is a product
  decision; if the app grants it, it is stored data (a freeze day recorded as a day), never a hidden
  exception in the rule.
- **Store the day an event belongs to**, captured when it started: a focus session started at 23:50 and
  finished at 00:10 belongs to the day it started. The fold never re-reads the clock at write time.
- **Instants stay instants.** A due time ("remind me at 09:00") or a completion timestamp is epoch ms
  (value-objects-money-and-units owns instants and their formatting); a due *day* is a `DateKey`.
  Never turn one into the other with `toISOString()`.

## Converting at the edges: pickers and servers

A key meets a `Date` in two places: a date picker (it takes and returns a `Date`) and a calendar
library. A server's date-only field needs no conversion at all.

- **Never parse a key with `new Date(key)` or `Date.parse(key)`.** ECMAScript parses a date-only string
  (`'2026-10-03'`) as UTC midnight, so everywhere west of UTC it is the previous local day: with
  `TZ=America/Los_Angeles`, `new Date('2026-10-03').getDate()` is `2`, and a due-day picker seeded with
  `new Date(task.dueOn)` opens on the 2nd. A date-time string without an offset
  (`'2026-10-03T09:00'`) is local time, which is why the bug hides in code that usually passes
  times. (`date-only-parse`)
- **Key to Date: `localNoonOfDateKey(key)`**, which is `new Date(y, m - 1, d, 12)` in local time
  (built with `setFullYear` so years below 100 stay themselves). Noon keeps clear of midnights that
  DST skips (America/Havana, America/Santiago). Use it only on a key `isDateKey` accepted.
- **Date to key: `dateKeyOfLocalDate(date)`**, the local `getFullYear()`, `getMonth() + 1` and
  `getDate()`, zero-padded: the picker's result is a day the user chose where they are. Never
  `toISOString().slice(0, 10)` (`utc-day`): at local noon in Pacific/Kiritimati (UTC+14) it is
  already the previous UTC day.
- **Where they live: `src/services/clock/local-date.ts`**, beside the adapter, because the clock folder is
  the one place a `Date` becomes a key (check-calendar-code leaves it out of `local-day-key`). It is
  not an adapter: it reads no clock, so features import it directly and tests need no fake. The file
  belongs with the clock files (architecture-and-boundaries); until that skill ships it, write it from
  `examples/local-date.ts` with its test
  (`examples/local-date.test.ts`) at exactly that path, so the
  synced copy replaces it later without a change to its callers.
- **A server's `'YYYY-MM-DD'` already is a DateKey.** Validate it with `isDateKey` where it enters the
  app (the API layer's schema) and keep it a string; never round-trip it through `Date`. A server
  instant (`'2026-10-03T07:15:00Z'`) becomes epoch ms (`Date.parse` is right for a string with an offset);
  its local day, when a screen needs one, is `dateKeyOfLocalDate(new Date(epochMs))`, never its first
  ten characters.
- Verified on 2026-10-10 with Node 26.4 (the parse rule is ECMAScript's Date Time String Format, the
  same in Hermes). Re-verify: `TZ=America/Los_Angeles node -e 'console.log(new Date("2026-10-03").getDate(), new Date(2026, 9, 3, 12).getDate())'`
  prints `2 3`. The example's test passes under `TZ=UTC`, `America/Los_Angeles`, `Pacific/Kiritimati`,
  `America/Havana` and `Europe/Berlin` (the canonical Jest config pins `TZ=UTC`; a scratch copy with
  `process.env.TZ ??= 'UTC'` lets `TZ=<zone> npx jest` probe a zone).

## The countdown to the next day

```ts
const { hours, minutes } = useNextDayCountdown(); // src/hooks/use-next-day-countdown.ts
```

- The time left comes from `msUntilNextLocalDay()`; `splitCountdown(ms)` (pure, in
  `src/core/countdown/split-countdown.ts`, which the hook imports and nothing else needs, so an app
  without streaks or statistics copies just the hooks and this folder) rounds minutes up, so the line
  never reads "0 h 0 min" while today is still running (11,100,000 ms gives 3 h 5 min; 30 s gives
  0 h 1 min; 90,000,000 ms on the day clocks fall back gives 25 h 0 min).
- The hook's snapshot is whole minutes and its timer fires exactly when the shown minute changes
  (`msUntilMinuteChange`), so React re-renders once a minute, not every second.
- Call it on every render of the model hook (a hook never sits behind a condition) and show the line
  only when it applies (`summary.isDone`). When the countdown ends, `useToday()` turns the day and the
  line disappears with the summary.
- Never compute it in a component: `86_400_000 - nowMs() % 86_400_000` is the time to midnight in
  London (`day-ms-arithmetic`, `day-maths-in-ui`). check-calendar-code runs `splitCountdown` against
  pinned values (`view-countdown`) and requires the module once the hook exists.
- A reminder before midnight ("your streak ends in 2 hours") is a scheduled notification; local-notifications
  owns DST-safe schedules.

## Counting days and durations

| Question | Right | Wrong |
|---|---|---|
| days until a due day | `daysBetween(today, dueOn)` | `Math.floor((dueAtMs - nowMs) / 86_400_000)` |
| the day after | `addDays(today, 1)` | `nowMs + 86_400_000` then a day key |
| was it today | `completedOn === today` | `completedAtMs > nowMs - 86_400_000` |
| time to midnight | `msUntilNextLocalDay()` | `86_400_000 - nowMs % 86_400_000` |
| a 24-hour lifetime (a cache, a rate limit) | `nowMs - savedAtMs >= 86_400_000` with `// not-a-calendar-day: <why>` when divided | — |

Dividing or taking the modulo of a duration by one day of milliseconds (in any spelling: `86_400_000`,
`(1000 * 60 * 60 * 24)`, `/ 1000 / 60 / 60 / 24`, a `ONE_DAY` constant) is what `day-ms-arithmetic`
reports anywhere in `src/` outside the clock folder. A genuine 24-hour duration carries the marker
comment with its reason on the line or the line above; so does a UTC date an API asks for (`utc-day`).
The "day after" and "was it today" rows (adding or subtracting a day of milliseconds) are not checked:
24-hour lifetimes use the same form legitimately, so they are review items (see checkers.md).

## Formatting dates (hand-off) and the calendar caveat

Day code never formats. Labels ("Saturday", "26 Sep", "2 h 14 min", "75%") are built at the edge by
the i18n layer: `src/i18n/format-date.ts` builds day-month and weekday labels from catalog messages,
and a time of day uses `Intl.DateTimeFormat` inside `src/i18n/` only, on the forced FormatJS polyfill
with an explicit calendar and time zone (i18n-strings-and-catalogs owns the rule and the formatter).

The caveat: native Hermes on iOS formats some locales in their local calendar (`fa` in the Solar Hijri
calendar) and ignores the requested digits. Keys are always Gregorian civil dates whatever calendar the
user reads, so a key is never parsed from, or built out of, a formatted string (`wall-clock` reports
`toLocale*String` and `Intl.DateTimeFormat` in day code).

## iOS and Android behaviour

| | iOS | Android |
|---|---|---|
| AppState values | `active`, `inactive` (app switcher, Control Center, a call), `background` | `active`, `background` |
| JS timers while backgrounded | suspended with the app | stop once the app is cached or the device dozes |
| Resume after midnight | AppState `active` fires; `useToday` re-reads | AppState `active` fires; `useToday` re-reads |
| User sets date or zone by hand | Settings, General, Date & Time (turn off Set Automatically) | Settings, System, Date & time (turn off automatic) |
| Zone change while the app runs | noticed by the next `useToday` tick or resume; whether Hermes picks up a new zone without a relaunch is not verified here | same; not verified here |

Both platforms report the local date only through the clock adapter. Everything above the adapter is
the same code on both platforms, which is why it is tested once, in Jest.

## Testing calendar code

- **Pure code:** pass keys and numbers. No fake timers in logic tests (unit-and-component-tests' rule);
  `createFakeClock` for services and stores.
- **The day hooks:** their own timers are the unit under test, so their tests use Jest's fake timers
  and move the fake clock in step (`clock.advance(ms)` then `jest.advanceTimersByTime(ms)`); render
  through `renderHookWithProviders(() => useToday(), { services: { clock } })`.
- **The adapter:** its test holds in any zone (today changes exactly when the countdown ends). The
  canonical Jest config sets `TZ=UTC`; to probe a DST zone by hand, run the Date-constructor logic in
  plain Node with `TZ=<zone>`, as the re-verify loop above does.
- **Properties:** a derived streak agrees with the stored one; the countdown never shows zero while time
  is left; a total never shrinks whatever the order of days (the templates' tests).

## Device probes

Run only on a simulator or emulator created for the purpose and named, never on a booted or shared one.

- iOS Simulator follows the Mac's time zone. Launching the app with a zone is
  `SIMCTL_CHILD_TZ=Pacific/Chatham xcrun simctl launch <udid> <bundle-id>` (the variable reaches the
  app's process; that Hermes honours it was not verified here). Changing the simulator's date means
  changing the Mac's, so prefer the app's debug set-date tool (debug-menu-and-test-hooks).
- Android Emulator: Settings, System, Date & time on the named emulator (`adb -s <serial> shell am start -a android.settings.DATE_SETTINGS`
  opens the screen), then switch the zone and resume the app.

## Appendix: React Navigation 7 (static API)

`useToday` needs no navigation library. An app on React Navigation that restarts work on focus uses
`useFocusEffect` from `@react-navigation/native` the same way Expo Router's `useFocusEffect` is used;
the day itself still comes from `useToday()`.
