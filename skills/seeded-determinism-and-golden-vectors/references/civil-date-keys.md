# Civil-date keys

A day identity is a civil date written `'YYYY-MM-DD'`, computed with integer arithmetic. It is never an
instant, never a `Date`, and never depends on the device's time zone once it exists. This file covers
the key type, its arithmetic, how a key is obtained, and the pinned facts that prove the arithmetic.

## Contents

- Why a key and not an instant
- The API (`src/core/dates/date-key.ts`)
- Where the key comes from
- Comparing keys and routing versions
- The daily seed of a key
- Tests and the independent oracle
- Device behaviour (iOS and Android)

## Why a key and not an instant

"The 4th of July" is the same day for everyone who says it, but `2026-07-04T00:00:00Z` is still the 3rd
in New York. Content keyed by an instant makes every read zone-dependent, so two users who both see
"Saturday" can get different content. A key is a value: copy it, store it, compare it, hash it.
Event timestamps (when a task was completed) remain UTC instants; only day identities are keys.

## The API (`src/core/dates/date-key.ts`)

| Function | Meaning |
|---|---|
| `DateKey` | `string` in `'YYYY-MM-DD'` form (a type alias: validate untrusted input with `isDateKey`) |
| `dayNumber(key)` | days since 1970-01-01; `NaN` unless the key has the shape (`'2026-9-26'`, ISO instants and padded text give `NaN`) |
| `fromDayNumber(days)` | the inverse |
| `isDateKey(text)` | true only for a real calendar day (`'2026-02-29'` and `'2026-02-30'` are false) |
| `addDays(key, n)` · `daysBetween(a, b)` | arithmetic on day numbers |
| `isoWeekday(key)` | 1 = Monday … 7 = Sunday |

The arithmetic is Howard Hinnant's `days_from_civil` / `civil_from_days` (public domain, proleptic
Gregorian, integer division with `Math.floor`): no `Date`, no zone, the same answer in Jest and on
every device. `src/core/dates/generator-versions.ts` (the cutover table) builds on it.

Validate every key that arrives from outside (storage, a deep link, a share code) with `isDateKey`
before generating from it: `dayNumber('2026-02-30')` quietly returns March 2nd's number.

## Where the key comes from

There is one day definition in the app: the user's local civil day, read at the edge with
`clock.today()` (the `ClockPort` of architecture-and-boundaries). dates-streaks-and-statistics owns
the rest of the story: re-reading today after midnight and on foreground, DST, time-zone changes,
streaks, the countdown to the next day. This skill only requires that:

- the key is computed once, at the edge, and passed into every seeded function;
- every comparison that touches the key (already done today, streak, cutover routing) uses the same
  key, never a second definition such as the UTC day;
- a stored outcome stores the key it was made for, so a run that ends after midnight still belongs to
  the day it started.

Content derived from a UTC day while "already done today" uses the local day disagrees for hours every
day; users far from UTC hit it daily, developers near UTC almost never. Do not mix them.

## Comparing keys and routing versions

Keys with four-digit years compare correctly as strings (`'2027-02-28' < '2027-03-01'`), which is how
`versionFor(versions, key)` picks the version that serves a key. A text-keyed table (every entry
`from: null`, `assertVersionTable(versions, { keyKind: 'text' })`) has no dates to compare, so
`versionFor` throws for it and callers pass the version the key carries. Year 10000 is out of range; so are
negative years. Keep keys between `0001-01-01` and `9999-12-31` and nobody needs to think about it.

## The daily seed of a key

`dailySeed(key, salt)` (`src/core/dates/daily-seed.ts`) turns a key and a feature salt into a uint32. It
is a hash, not a draw: pass it to `seedRng` before drawing (`seeded-rng-and-seeds.md`, "The
unmixed-seed trap"). Its goldens (`('2026-09-26', 17)` gives `2599028541`) are a compatibility contract.

## Tests and the independent oracle

The pinned facts in `date-key.test.ts` were computed with Python's `datetime.date` (a different
implementation of the same calendar):

| Fact | Value |
|---|---|
| `dayNumber('1970-01-01')` · `('2026-09-26')` · `('2000-03-01')` | `0` · `20722` · `11017` |
| `dayNumber('1900-01-01')` · `('2400-12-31')` | `-25567` · `157419` |
| `isoWeekday('2026-09-26')` · `('1969-12-28')` | `6` (Saturday) · `7` (Sunday) |
| `addDays('2100-02-28', 1)` · `addDays('2000-02-28', 1)` | `'2100-03-01'` (no leap day) · `'2000-02-29'` |

The test also round-trips every day from 1900 to 2400 with fast-check, and `check-determinism.mjs`
compares the app's functions with `Date.UTC` (a third implementation) every 37 days over the same
range. Reproduce a fact: `python3 -c "from datetime import date; print((date(2026,9,26)-date(1970,1,1)).days)"`.

The canonical Jest config sets `TZ=UTC` for every worker, so a test that accidentally reads the
machine's zone behaves the same on every developer's laptop and in CI; seeded code never reads it.

## Device behaviour (iOS and Android)

- The key changes when the user's local date changes: at local midnight, and when the user changes
  time zone or the system date (both platforms let users set the date by hand). The content for a key
  never changes; which key is "today" does. That is intended: a traveller gets the content of the day
  they are in, and the same key gives the same content on every device.
- A user can move the clock back and see yesterday's key again. Generators do not care; streak and
  "already done" rules do (dates-streaks-and-statistics).
- Both platforms report the local date through the `ClockPort` adapter, the one file that reads
  `Date`; tests use the fake clock and never the device.
