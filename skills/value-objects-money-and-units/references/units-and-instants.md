# Units and instants

## Contents

1. Canonical units
2. Exact factors
3. Choosing the canonical unit
4. Converting in and out
5. Temperature and other affine scales
6. Durations versus calendar days
7. Instants
8. ISO 8601 at the wire
9. Seconds versus milliseconds
10. Date pitfalls
11. Tests

## 1. Canonical units

A physical quantity is stored once as an integer in its dimension's canonical unit, and its name ends
with that unit. The person's unit system changes only the display.

| Dimension | Canonical unit (template) | Name ends with | Example |
|---|---|---|---|
| Length, distance | millimetre | `Mm` / `_mm` | `distanceMm`, `heightMm` |
| Mass | gram | `G` / `_g` | `weightG` |
| Volume | millilitre | `Ml` / `_ml` | `volumeMl` |
| Duration | millisecond | `Ms` / `_ms` | `durationMs`, `timeoutMs` |
| Data size | byte | `Bytes` / `_bytes` | `sizeBytes` |
| Instant | epoch millisecond | `AtMs` / `_at_ms` | `createdAtMs` |

`check-value-code.mjs` (`unit-suffix`) reads type declarations in the stored layers (`src/core`,
`src/stores`, `src/data`, `src/services`, `src/api`) and fails a number named with a physical word
(`duration`, `timeout`, `delay`, `interval`, `elapsed`, `ttl`, `age`, `distance`, `weight`, `mass`,
`temperature`, `speed`, `altitude`, `elevation`) whose last segment is not a unit. Layout words
(`width`, `height`, `size`, `volume` as in audio volume) are left alone: they are density-independent
pixels or 0..1 levels, not stored physics.

## 2. Exact factors

Each display unit is an exact ratio of canonical units (`[numerator, denominator]`), from the
definitions, so no float constant ever enters storage:

| Unit | Canonical units | Definition |
|---|---|---|
| inch | 254/10 mm | 25.4 mm exactly (1959 international yard and pound) |
| foot | 3048/10 mm | 12 in |
| yard | 9144/10 mm | 0.9144 m exactly |
| mile | 1,609,344 mm | 1760 yd |
| ounce (avoirdupois) | 28,349,523,125/10^9 g | 1/16 lb |
| pound | 45,359,237/100,000 g | 0.45359237 kg exactly |
| stone | 635,029,318/100,000 g | 14 lb |
| US fluid ounce | 295,735,295,625/10^10 mL | 1/128 US gallon |
| US gallon | 3,785,411,784/10^6 mL | 231 cubic inches |
| imperial gallon (not an Intl unit) | 4,546,090/1000 mL | 4.54609 L exactly |
| kilobyte, megabyte, gigabyte | 10^3, 10^6, 10^9 B | SI prefixes |

Intl's `gallon` and `fluid-ounce` are the US units; an app for the UK that shows imperial gallons
formats the number with a catalog unit label. File sizes: Android's `Formatter.formatFileSize` uses SI
prefixes since Android 8.0 (1 kB = 1000 B), and Apple's file-size style is decimal on current systems
(both from the platform documentation, not re-measured on devices), so `DATA` uses SI prefixes; a
binary display (KiB) is a separate dimension, never mixed.

## 3. Choosing the canonical unit

Fine enough that every value the app accepts is a whole number, coarse enough that the largest value
stays far below 2^53. Millimetres hold distances to 9 billion km; grams hold 9 billion tonnes but lose
half a gram of a spice: a medicine or recipe app picks milligrams. Change the canonical unit only with
a migration that rescales every stored row, never by reinterpreting old rows.

## 4. Converting in and out

- **Typed text**: `quantityFromDecimal(LENGTH, '5.5', 'kilometer')` parses exact decimal text
  (normalized at the edge first) and rounds half-even once into the canonical integer (5,500,000).
- **A measured float** (a GPS distance in metres from a map SDK, a sensor reading):
  `quantityFromMeasurement(LENGTH, 1234.5678, 'meter')` rounds half-even once (1,234,568).
- **Display**: `quantityToDisplay(LENGTH, canonical, 'mile')` returns a float for the formatter only;
  `formatQuantity` in `src/i18n/` formats it with the locale tag. Nothing displayed is stored back.
- **The unit system**: expo-localization's `getLocales()[0].measurementSystem` (`'metric'`, `'us'`,
  `'uk'`, or null on web; SDK 57) picks the default display unit; a settings toggle overrides it
  (settings-and-preferences). Switching it re-renders text, never rewrites rows.

## 5. Temperature and other affine scales

Celsius and Fahrenheit are not ratios of each other (°F = °C × 9/5 + 32), so they do not fit the
factor table. Store temperature as an integer in tenths of a degree Celsius (`temperatureDeciC`) or
in millikelvin, convert to Fahrenheit for display with the affine formula, and round once. Never store
the person's chosen scale.

## 6. Durations versus calendar days

A duration is a length of time (`durationMs`); "3 days later" in a person's calendar is not
3 × 86,400,000 ms (DST makes some days 23 or 25 hours). Day arithmetic is DateKey arithmetic
(`addDays`, `daysBetween`) in dates-streaks-and-statistics. `DURATION` stops at hours on purpose.

## 7. Instants

An instant is the moment something happened or will happen (created, completed, synced, a reminder's
fire time): an integer of milliseconds since 1970-01-01T00:00:00Z, the same number on every phone in
every zone. The clock port's `nowMs()` produces it (architecture-and-boundaries owns the port; only
the clock adapter reads the wall clock).

- Code: `createdAtMs: number`; SQLite: `created_at_ms INTEGER NOT NULL` (the harness's own tables do
  this); JSON for the app's own files: the integer.
- Never a `Date` in state, a store or a row: it is mutable, `JSON.stringify` turns it into a string,
  and Zustand persistence or a repository hands back a string the type still calls `Date`
  (`instant-type`).
- Never a local time string ("2026-10-10 08:30"): it names a different moment on every phone.
- Showing an instant is formatting at the edge (i18n-strings-and-catalogs: `Intl.DateTimeFormat` in
  `src/i18n/` with an explicit time zone); turning an instant into a local day is the clock adapter's
  job (dates-streaks-and-statistics).

## 8. ISO 8601 at the wire

APIs and exports carry instants as ISO 8601 text with `Z` or an explicit offset.
`parseIsoInstant(text)` accepts `YYYY-MM-DDTHH:mm[:ss[.fraction]]` followed by `Z`, `±HH:MM` or `±HHMM`,
checks every field (29 February only in leap years, hour 00-23, no leap second 60, offsets up to
±23:59), and returns:

| Text | Result |
|---|---|
| `2026-10-10T08:30:00Z` | `1791621000000` |
| `2026-10-10T10:30:00+02:00` | the same |
| `2026-10-10T08:30:00.250Z` | `+ 250`; fractions beyond milliseconds are truncated |
| `2026-10-10` | `{ kind: 'date-only' }`: a DateKey, not an instant |
| `2026-10-10T08:30:00` | `{ kind: 'missing-offset' }`: local time on an unknown device |
| `2026-02-29T00:00:00Z`, `Sat Oct 10 2026` | `{ kind: 'not-an-instant' }` |

The `T` and `Z` may be lower case (`t`, `z`), as RFC 3339 allows. Days are counted with civil
arithmetic (days_from_civil), not `Date.UTC`, which maps the years 0-99 to 1900-1999, so every year
0000-9999 reads correctly; a moment that an offset pushes outside 0000-01-01T00:00:00.000Z ..
9999-12-31T23:59:59.999Z is `not-an-instant`, so every accepted text round-trips. `toIsoInstant(atMs)`
writes `2026-10-10T08:30:00.000Z` (the same text as `Date.prototype.toISOString`, for the same range),
the only form the app sends.

## 9. Seconds versus milliseconds

Many APIs (and JWT `exp`) send epoch seconds. Read them once with `instantFromEpochSeconds(seconds)`
at the boundary; a name without a unit (`createdAt: number`) is a failure because nobody can tell
1,791,621,000 (seconds, 2026) from 1,791,621,000 ms (21 days after 1970).

## 10. Date pitfalls

- ECMAScript parses a date-only ISO string as UTC midnight and a date-time ISO string without an
  offset as local time; any other format is implementation-defined, so Hermes, V8 and JavaScriptCore
  may disagree. `parseIsoInstant` never calls `Date.parse`.
- `new Date()` with no argument reads the wall clock and is banned outside the clock adapter by the
  lint config; `new Date(atMs)` only converts.
- `getUTC*` and `toISOString().slice(0, 10)` give the UTC day, not the person's day
  (dates-streaks-and-statistics' `utc-day`).

## 11. Tests

Units: one case per exact factor, the half-even ties (0.25 cm → 2 mm, 0.35 cm → 4 mm), a round trip of
random canonical integers through a display unit and back. Instants: each accepted form, each refused
form, a round trip of random instants across 0000-9999 (the whole wire range) through `toIsoInstant`. Jest runs with
`TZ=UTC` (the canonical jest config), so a parser that leans on local time would pass there and fail on
a phone: the refusal cases are what catch it.
