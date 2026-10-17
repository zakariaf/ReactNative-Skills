# The determinism policy

What code on a seeded path may use, why each banned API gives different answers on different devices,
and who enforces what. A seeded path is any code whose output a user may compare with another user's
or with their own past: daily content, generated layouts, shuffles, share codes, replays.

## Contents

- Where the policy applies
- Allowed operations, and why only these
- Clocks: the key is an argument
- Randomness: one source
- Locale data: never on a seeded path
- Ordering: explicit and stable
- Floats: integers first, frozen when stored
- iOS, Android and Jest side by side
- Who enforces what
- Pitfalls and fixes

## Where the policy applies

| Path | Why it is seeded |
|---|---|
| `src/core/rng/**`, `src/core/dates/**` | the PRNG, draws, fingerprints, civil-date keys, daily seeds |
| each generator module in `contracts/seeded-generators.json` | content every device must compute identically |
| the contract's `"paths"` globs | other seeded code you name explicitly |
| `src/games/*/{rules,levels,sim,geom}/**` | the games plugin: rules, levels, real-time sims and geometry replay bit-exactly |
| every local file any of the above imports, at any depth | a helper runs inside the generator, so its output is the generator's output |

The canonical ESLint config's `DETERMINISTIC` block covers the first and fourth rows by path, and
generator modules named `<name>-generator.ts` anywhere under `src/` (so name every generator that
way); `check-determinism.mjs` covers all five (it follows value imports, `import()` and `require()`
through relative paths, `tsconfig` aliases and workspace packages, never into `node_modules`) and also
runs the core modules. Test files on these paths may
use `**` and inexact maths to compute bounds, but never read a clock or real randomness. They may
build fixed instants to compare with, `Date.UTC(2026, 8, 26)`, `new Date(<arguments>)` and the
`getUTC*` methods, because those read no clock (and the canonical Jest config pins `TZ=UTC`);
`Date.now()`, `Date.parse`, an argument-less `new Date()` or `Date()` and `performance.now()` stay
banned there. Non-test seeded code keeps the full ban: a generator never needs an instant.

## Allowed operations, and why only these

Allowed: `+ - * /`, `%`, bitwise operators, `Math.sqrt`, `Math.imul`, `Math.floor`, `Math.round`,
`Math.abs`, `Math.min`, `Math.max`, `Math.PI`, integer and string operations.

Banned: `**` and `Math.pow`, every other `Math.*` (`sin`, `cos`, `tan`, `atan2`, `exp`, `log`,
`hypot`, `cbrt`, …), `Math.random`, `Date`, `performance.now`, `Intl`, `toLocale*`, `localeCompare`.

Why (verified on 2026-10-03 against ECMA-262 2027 draft and the Hermes source; re-verify by reading
`https://tc39.es/ecma262/multipage/numbers-and-dates.html` and Hermes' `lib/VM/JSLib/MathStdFunctions.def`):

- ECMA-262 defines `+ - * /` as IEEE 754 binary64 operations and `Math.sqrt` as `𝔽(the square root
  of ℝ(n))`: one correctly rounded answer, the same on every engine. `Math.imul`, `floor`, `round`,
  `abs`, `min`, `max` and the integer operators are exact.
- For `sin`, `cos`, `exp`, `log`, `hypot`, `pow` and `**` (`Number::exponentiate`) the spec says
  "an implementation-approximated Number value". V8 (Jest, Node) ships its own implementations;
  Hermes maps them to the C library (`std::sin`, `std::exp`, …), which is Apple's libm on iOS and
  Bionic's libm on Android. The last bits can differ between Jest, an iPhone and an Android phone,
  and between OS versions. One differing bit in a seeded computation changes everything after it.
- `Math.ceil`, `trunc`, `sign`, `fround`, `clz32` and the constants (`E`, `LN2`, `SQRT2`, …) are
  also exactly specified; the lint allow-list keeps to the shorter set so there is one list to
  remember (`-Math.floor(-x)` is `ceil`). `check-determinism.mjs` says so in its message for these
  members. Add one to both lists together if a generator truly needs it.

## Clocks: the key is an argument

A generator takes its key (`DateKey`, an id, a sequence number) as a parameter. Nothing reachable from
it calls `Date.now`, `new Date`, `performance.now` or imports the clock service. "Today" is read once at
the edge, `clock.today()` from `ClockPort` (architecture-and-boundaries owns the port; dates-streaks-
and-statistics owns local midnight, time zones and DST), and passed in. A generator that reads a clock
cannot be pinned by vectors, replayed from a bug report, or run for tomorrow in a test.

## Randomness: one source

Every draw comes from the seeded RNG threaded into the function (`seeded-rng-and-seeds.md`).
`Math.random`, `crypto.getRandomValues`, `crypto.randomUUID`, `expo-crypto`'s `getRandomBytes` and
`randomUUID`, `uuid`, `nanoid` and PRNG libraries (`seedrandom`, `pure-rand`, `random-js`, `chance`,
faker) are banned on seeded paths. Outside them they are fine: a new task's id comes from
`expo-crypto`'s `randomUUID()`, because ids must be unique, not reproducible.

## Locale data: never on a seeded path

Hermes implements `Intl`, `localeCompare` and `toLocale*` with each platform's own facilities: its
documentation says it consumes "the Android and iOS platform provided facilities for space efficiency,
but at the cost of some variance in behaviours across Android and iOS platforms" (ICU4J on Android,
Foundation on iOS; verified on 2026-10-03 in Hermes' `doc/IntlAPIs.md`). Jest runs V8 with full ICU,
a third implementation. So `names.sort((a, b) => a.localeCompare(b))` can order the same list
differently on an iPhone, a Pixel and in CI, and a draw from the sorted list then differs too.
Compare with `<` on a fixed key on seeded paths; format with `Intl` only at the edge, in `src/i18n`
(i18n-strings-and-catalogs).

## Ordering: explicit and stable

- `Array.prototype.sort` is stable (ECMA-262 since ES2019) and its default comparator compares UTF-16
  code units, so `keys.sort()` on strings is deterministic. A comparator must be consistent; an
  inconsistent one (`() => rng() - 0.5`) gives an implementation-defined order.
- `Map`, `Set` and object key order is insertion order, except that integer-like object keys come
  first in ascending order (`{ "10": a, "9": b }` iterates `"9"` first). Sort by an explicit key before
  drawing from anything built from a record.
- Rows from SQLite without `ORDER BY` come back in whatever order the query plan gives; a generator's
  input from storage is sorted by a stable key first (persistence-and-migrations).
- Catalogs a generator draws from are frozen literals inside the version that uses them; a catalog
  that arrives from the network or a translation file is not a generator input (draw an index, then
  look the text up at the edge).

## Floats: integers first, frozen when stored

Prefer integers (counts, ids, indices, minor units). `/` is exact-rounded, so a float computed only
with `+ - * /` and `sqrt` is reproducible, but its printed form is long and accumulating in a different
order gives a different double. Before a value enters a fingerprint or a stored outcome, freeze it to
an integer (`Math.round(x * 1000)`); the canonical JSON of the fingerprint rejects floats outright.
value-objects-money-and-units owns integer money and units.

## iOS, Android and Jest side by side

| Operation | Jest (V8, Node) | iOS (Hermes) | Android (Hermes) | On a seeded path |
|---|---|---|---|---|
| `+ - * /`, `Math.sqrt`, integer ops | IEEE 754, exact | same bits | same bits | allowed |
| `Math.sin/exp/pow`, `**` | V8's own maths | Apple libm | Bionic libm | banned |
| `localeCompare`, `Intl.*`, `toLocale*` | full ICU | Foundation | ICU4J | banned |
| `Math.random` | implementation-defined | implementation-defined | implementation-defined | banned |
| `Date`, `performance.now` | machine clock, `TZ=UTC` in Jest | device clock and zone | device clock and zone | banned |
| sfc32, `dailySeed`, `fingerprint` | reference values | same values | same values | the only sources |

The values in the last row are verified in Jest and by the Node checkers; the template tests run in
the jest-expo `ios` preset. Running the same golden tests on a device is the job of an E2E or debug
check (e2e-maestro, debug-menu-and-test-hooks); until one exists, the integer-only policy is the
argument for device equality, not a measurement. The planned home is a debug-menu row
(debug-menu-and-test-hooks: a reducer action, a model row and the testID `debug.menu.goldens`) that
runs the canonical vectors on the device and shows pass or the first mismatch, with the vectors'
`fingerprint` digest as text, so one e2e-maestro flow asserts the same digest on the named iOS
simulator and Android emulator. Neither the row nor the flow is built yet (e2e-maestro leaves it to
that row), so a report says "golden vectors not run on a device" under "Not tested or not verified".

## Who enforces what

| Check | Catches | Owning skill |
|---|---|---|
| ESLint `DETERMINISTIC` block (`src/core/rng`, `src/core/dates`, games folders, `src/**/*-generator.ts`) | `Math.*` outside the allow-list, `**`, plus the app-wide `Math.random`/`Date.now`/`new Date` bans | typescript-and-lint-rules (the config); this skill (the policy) |
| `check-determinism.mjs` | the same bans on generator modules, contract paths and **every local file they import** (the chain is printed), including the other packages of a workspaces repo; clocks, randomness (also destructured: `const { random } = Math`) and PRNG packages loaded by `import()` or `require()`; locale calls; unmixed seeds; the core modules against an independent implementation and goldens | this skill |
| `check-golden-vectors.mjs` | at runtime, a clock, randomness, locale data or an implementation-approximated `Math` function (`exp`, `sin`, `pow`, …) reached by anything a generator calls, a `node_modules` package included; repeatability. Not `**`: an operator cannot be trapped. Not a module-level capture either (`const { exp, random } = Math`, `const draw = Math.random`): the traps replace the functions only during each call, and a captured reference still points at the real one. The text scan above is the only check of both | this skill |
| the vectors tests in Jest | any change in output on the machine that runs them (V8). They cannot see an `exp` that rounds differently on a phone; the two checkers above are what keep inexact maths out | this skill (templates) |

## Pitfalls and fixes

- **`new Date().toISOString().slice(0, 10)` as today's key.** That is the UTC day: for hours every day
  it disagrees with the user's local day. Use `clock.today()` at the edge and pass the key in.
- **`Math.random()` for a "harmless" tie-break inside a generator.** One call and no two devices agree.
  Draw the tie-break from the threaded state, or break ties by a fixed key.
- **`Math.pow(2, n)` or `2 ** n` in a generator.** Use a shift (`1 << n`, n < 31), a multiply loop or a
  literal table.
- **Sorting a catalog with `localeCompare` before drawing.** Sort with `<` on the id, or keep the
  catalog in its literal order.
- **A helper in `src/utils/` that a generator imports and that reads the clock or calls `Math.exp`.**
  It is not a seeded path by itself, but `check-determinism.mjs` follows the generator's imports into
  it and names the chain, and the runtime trap in `check-golden-vectors.mjs` fails the call while a row
  generates. Pass the value in; use an integer table instead of `exp`. A package from `node_modules`
  (a library `shuffle` that calls `Math.random`) is caught by the runtime trap only.
- **A generator that keeps a cache across calls keyed by something other than (key, version).** The
  second call returns the first key's answer. Cache only by the full input, or not at all.
