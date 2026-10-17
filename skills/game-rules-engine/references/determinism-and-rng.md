# Determinism and the seeded RNG in game rules

How the determinism policy applies to a game's rules, and how a game uses the one seeded random
number generator. seeded-determinism-and-golden-vectors owns the policy, `src/core/rng/sfc32.ts` and
its golden values; this file is what a rules author needs from them.

## Contents

- The policy, applied to rules
- Why these operations and no others
- Practical consequences for games
- The RNG API
- The golden values (compatibility contract)
- Randomness only in create
- Randomness during play: the stream lives in the state
- Randomness outside rules: sims, particles, bots
- The daily level

## The policy, applied to rules

Applies to `src/core/game/**` (the kit) and `src/games/*/{rules,levels,sim,geom}/**`:

- Allowed: `+ - * /`, `%`, bitwise operators, `Math.sqrt`, `Math.imul`, `Math.floor`, `Math.round`,
  `Math.abs`, `Math.min`, `Math.max`, `Math.PI`.
- Not allowed: `**` (it is `Math.pow`), every other `Math.*` (`sin`, `cos`, `atan2`, `exp`, `log`,
  `pow`, `hypot`, ...), `Math.random`, `Date` (`Date.now`, `new Date`), `performance.now`, `Intl`,
  `toLocale*` and `localeCompare`.
- Tests in those folders may use `**` (`2 ** 32` as a fast-check bound) but never `Math.random`,
  `Date.now`, `new Date()` or `performance.now()`: tests never read real time or real randomness either.

The canonical ESLint config enforces it for the games' `rules`, `levels`, `sim` and `geom` folders and
`src/core/rng/` (the `DETERMINISTIC` and `PURE` blocks, owned by typescript-and-lint-rules); its
`DETERMINISTIC` list does not name `src/core/game/**` yet, so for the kit this skill's checker is the
enforcement (`determinism`: it scans the kit and every rules folder). The `check-determinism.mjs`
of seeded-determinism-and-golden-vectors follows imports from seeded paths. A game that diverges
between devices breaks saves, replays and the daily.

## Why these operations and no others

Jest runs on V8, which computes `sin`, `exp` and `pow` with its own port of fdlibm; Hermes calls the
platform's C maths library, which is Apple's libm on iOS and bionic's on Android. ECMA-262 lets these
functions be approximations, so the last bits of a result can differ between an iPhone, an Android
phone, CI and a future OS update. A replay, a daily level ("the same board for everyone today") or a
saved undo history would then diverge. `+ - * /`, `%` and `Math.sqrt` are correctly rounded under
IEEE 754 and ECMA-262, and integer operations are exact, so they give identical bits everywhere.
Locale data also comes from the platform (iOS and Android ship different ICU builds), which is why
`Intl`, `toLocale*` and `localeCompare` stay out of rules.

## Practical consequences for games

- **No angles in simulation.** Reflect with dot products (`v - 2(v·n)n`), take directions from a
  committed table of unit vectors pasted as literals, normalise an aim vector with `Math.sqrt`.
- **Integers where possible.** Scores, grid positions, ticks, hit points and move counts are integers;
  quantise an aim vector to thousandths before it enters state.
- **Clocks never enter rules.** Time arrives as a tick count, a move count or a value the host passes
  in (from the `ClockPort`, dates-streaks-and-statistics owns "today").
- **`Intl` never enters rules.** Localised digits are the surface's `toView` job (i18n-strings-and-catalogs).
- **Order ids with `<`, never `localeCompare`**; a `Set` or object key order is never a move order.
- **Rendering may use trigonometry** (it is not simulation), but keep particles and shake on the
  same rules so a recorded run renders identically.

## The RNG API

`src/core/rng/sfc32.ts` (Chris Doty-Humphrey's sfc32 from PractRand: 128 bits of state, only 32-bit
integer operations, so every JavaScript engine produces the same sequence). The state is four unsigned
32-bit integers, JSON-safe; every function returns the value and the next state, with no hidden
mutation. The file carries a file-level `'worklet';` directive so a real-time sim can draw on the UI
thread.

| Function | Use |
|---|---|
| `seedRng(seed)` | A warmed-up `RngState` from any integer seed (four `mix32` words, 12 warm-up draws). |
| `nextU32(state)` | `{ value: 0..2^32-1, state }`. |
| `nextInt(state, n)` | Unbiased integer in `[0, n)`, by rejection sampling. |
| `nextUnit(state)` | Float in `[0, 1)`; division is correctly rounded, so deterministic. |
| `hashSeed(text)` | FNV-1a over UTF-16 code units: a text key to a seed. Mix it with `seedRng` before drawing. |
| `hashU32(a, b)` / `mix32(x)` | Stateless per-index randomness (particle directions, tile variants). |

`src/core/rng/seeded-draws.ts` (`drawOne`, `shuffle`, `drawSample`) documents how many draws each
helper consumes; use it for shuffles and picks instead of writing a new loop.

## The golden values (compatibility contract)

Pinned in `src/core/rng/sfc32.test.ts` (computed by an independent oracle) and checked by running the
real module in `check-rules-engine.mjs` (`rng-golden`, `rng-golden-test`):

| Call | Golden value |
|---|---|
| `seedRng(1)`, first five `nextU32` values | `1828152527, 3394835397, 2967886022, 2251045104, 4148684523` |
| `hashSeed('tasks:2026-09-26')` | `2847463752` |
| `nextU32` from `[1, 2, 3, 4]` | equals an independent transcription of PractRand's C code for 50 draws |

Changing the algorithm, the seeding, the warm-up count or a golden changes every generated level,
every daily and every saved run on every installed copy. If a change seems necessary, stop and ask
the developer: a different generator is a new module under a new name, never an edit.

## Randomness only in create

A scrambled start: seed locally, draw, and drop the RNG. The Lights Out template presses
`nextInt(rng, size)` cells of a dark board and keeps no stream, because nothing random happens during
play. Pin the board `create(1, 0)` makes as `GOLDEN_SEED_1_BOARD` in `create.test.ts`.

## Randomness during play: the stream lives in the state

Refills, spawns, card draws, dice: the state carries `rng: RngState` and every draw threads it.

```ts
// examples/pig/rules/roll-die.ts
export function rollDie(rng: RngState): { readonly face: number; readonly rng: RngState } {
  const draw = nextInt(rng, TUNING.dieFaces);
  return { face: draw.value + 1, rng: draw.state };
}
// apply-move.ts: const { face, rng } = rollDie(state.rng); ... { ...state, rng, turnTotal: ... }
```

- **Never re-seed from the move count** (or anything else) to avoid storing the stream: two runs that
  reach the same position by different paths would then draw different futures, and a continue or an
  undo would re-roll. The checker reports a rules file that draws after `create` while the state has
  no `RngState` (`rng-not-in-state`).
- **The stream survives a continue and a save.** `examples/pig/rules/continue-run.ts` keeps it, so the
  next roll is the one that would have come anyway.
- **Validate it on load.** `parseState` rebuilds the four words and rejects anything else
  (`examples/pig/rules/pig-persistence.ts`).
- **A second stream** (a generator scattering pieces, a bot) is derived with xor and a frozen salt:
  `seedRng(seed ^ 0x5bd1e995)`; never share one stream between two consumers.
- **Pin one sequence**: `GOLDEN_SEED_1_ROLLS` in `examples/pig/rules/roll-die.test.ts`.

## Randomness outside rules: sims, particles, bots

- A real-time sim keeps the four words in its own typed array and advances them with `nextU32`
  (realtime-game-loop).
- Particles use `hashU32(burstSeed, index)`: stateless, so a burst renders identically at any time in
  goldens.
- Bots get their own stream from `playBot` (`seedRng(seed ^ 0x5bd1e995)`) and return the advanced
  state; a bot that needs no randomness passes it through unchanged.
- Property tests pass fixed fast-check seeds where a test must reproduce (`{ seed: 42, numRuns: 300 }`).

## The daily level

The daily is `create(dailySeed(today, levels.daily.salt), levels.daily.difficulty)`, where
`dailySeed` is `src/core/dates/daily-seed.ts` (seeded-determinism-and-golden-vectors) and `today` is a
civil-date key the host reads once from the clock (dates-streaks-and-statistics). The rules never read
the date; the daily level, its goldens and its cutovers belong to level-generation-and-solvers.
