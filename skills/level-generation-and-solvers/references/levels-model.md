# The level model: packs, stars, unlocking, daily and endless

What the app expects from a game's `levels` member, the defaults this skill uses for levels, stars and
the daily level, and the pure helpers in `src/core/game/level-kit/` that implement them.

## Contents

- The defaults
- The types (`LevelsSpec`, `LevelEntry`, `LevelPack`, `StarRule`, `Solver`)
- One difficulty scale: the curve, the tuning rows, the daily and endless
- The levels contract (`contracts/levels.json`)
- Daily-only and endless-only games
- Pack layout and unlocking
- Stars
- The daily level
- Endless mode
- Who uses what

## The defaults

These are defaults, not laws: a game changes them in its plan and its contract entry, and the checker
then holds the game to what it declared.

- **Levels are generated, not drawn by hand:** the same seed and difficulty always make the same
  level, a solver proves every level before it ships ("no level is impossible") and computes **par**,
  the best possible result.
- **Layout:** 3 packs x 30 levels is the template's example (90 levels); any `packCount` and
  `levelsPerPack` work, declared once in `contracts/levels.json`.
- **Stars:** puzzle levels give 3 stars at or under par, 2 up to par + 2, 1 for finishing; score
  levels give 3/2/1 stars at score thresholds. The app keeps the best result per level.
- **Unlocking:** levels unlock one after another; packs unlock by stars collected in total (the second
  pack of 30 needs 45 stars), so no player is stuck behind one hard level. A locked tile says how
  many stars are missing. A paid entitlement never unlocks levels in this model (a product may decide
  otherwise; then it is the app's rule, not a change to `isLevelUnlocked`).
- **Modes:** the level table is always there; a daily level is a good default; an endless run is
  optional (games with no natural end).
- **Daily:** today's local date key plus the game's own salt, through the same generator as normal
  levels, at a medium difficulty; every device gets the same level on the same date with no server.

## The types (`LevelsSpec`, `LevelEntry`, `LevelPack`, `StarRule`, `Solver`)

From `src/core/game/levels.ts` (installed by game-rules-engine; this skill fills the `levels` member
of the game module with it):

```ts
type StarRule =
  | { kind: 'par'; par: number }                                       // puzzle games
  | { kind: 'score'; thresholds: readonly [number, number, number] };  // score games

type LevelEntry = { level: number; seed: number; difficulty: number; stars: StarRule };
type LevelPack = { id: string; nameId: MessageId; firstLevel: number; levelCount: number; starsToUnlock: number };
type SolveResult<TState, TMove> =
  | { kind: 'solved'; par: number; line: readonly TMove[]; final: TState } // final: where the line ends
  | { kind: 'unsolvable' }                                                  // the whole space was searched
  | { kind: 'budget-exceeded' };                                            // gave up (or a witness lost)
type Solver<TState, TMove> = { solve: (start: TState, maxNodes: number) => SolveResult<TState, TMove> };

type LevelsSpec<TState, TMove> = {
  difficultyFor: (level: number) => number;        // the curve, 0..99
  packs: readonly LevelPack[];
  table: readonly LevelEntry[];                    // pack-1.json + pack-2.json + ... concatenated
  solver: Solver<TState, TMove> | null;            // tooling, tests and hints; never needed to play
  daily: { kind: 'none' } | { kind: 'daily'; difficulty: number; salt: number };
  endless: { kind: 'none' } | { kind: 'endless'; difficulty: number }; // difficulty: ENDLESS_DIFFICULTY
};
```

Level numbers are 1-based and global across packs ("Level 12"). Seeds are uint32, difficulties whole
numbers on the one 0..100 scale (levels and the daily 0..99, 100 the endless run). The generator is the
engine's own `create(seed, difficulty)`: a level is nothing but its seed and difficulty, which keeps the
saved progress and the tables tiny. Every game with levels has a solver: an exact search for par games,
`createWitnessSolver` for games that draw during play (`solvers.md`).

`toLevelEntries(json)` (`level-kit/level-table.ts`) turns a committed pack file into typed entries and
throws a `RangeError` on anything invalid: JSON widens `kind` to `string`, so the table is validated,
never cast.

## One difficulty scale: the curve, the tuning rows, the daily and endless

Every game uses one difficulty scale, whole numbers 0..100, from `src/core/game/difficulty.ts`
(game-rules-engine): `create(seed, difficulty)` clamps to it; levels and the daily use 0..99
(`MAX_LEVEL_DIFFICULTY`); 100 (`ENDLESS_DIFFICULTY`) is reserved for the endless run and means
something only in a game whose `LevelsSpec` has an endless mode.

- **The curve** (`difficultyFor`) rises from 0 at level 1 to its cap at the last level and never falls.
  The cap is 99 unless the solver can only prove easier levels. The Lights Out template stops at 60
  (`LEVEL_DIFFICULTY_CAP`): past 4x4 boards with 8 scramble presses the exact solver's cost grows too
  fast for the generator's budget, and bigger boards are not more fun.
- **The tuning rows.** A game's tuning table lists rows easiest first; `knobsFor(d)` returns the
  endless row at 100 and otherwise row `rowFor(d, rows.length) = floor(min(max(floor(d), 0), 99) * rows / 100)`.
  With four rows, 0-24 plays row 0, 25-49 row 1, 50-74 row 2 and 75-99 row 3, so a 0..99 curve walks
  through every row.
- **The daily** uses one medium difficulty, 40 to 50 on the level scale by default, fixed forever per
  game. Pig (`examples/pig-levels/`) uses 45: the second of its four rows, which its balance sims
  measure at the row's lower bound.
- **Endless** is `create(freshSeed, 100)`. There is no mode argument: the engine sees
  `isEndlessDifficulty(difficulty)` and plays its endless row (Pig: no target, never won).

## The levels contract (`contracts/levels.json`)

One entry per game with levels; the checker holds the generated packs, the `LevelsSpec` and the
contract test to it (`templates/contracts/levels.json` and its schema):

| Key | Meaning | Checked against |
|---|---|---|
| `id` | the game id, the folder under `src/games` | the folder's `levels/` (an entry without one fails `levels-file-missing`; a folder without an entry fails `levels-config`) |
| `packCount`, `levelsPerPack` | the layout | the number and size of `pack-<n>.json` (`pack-config`), the plan, the contract test's `CONFIG` |
| `starRule` | `"par"` or `"score"` | every entry's `stars.kind` (`pack-config`), `solver-required` |
| `daily`, `endless` | the modes | `levels.daily` and `levels.endless` (`daily-mode`, `endless-mode`) |

new-game-scaffold's `contracts/games.json` declaration states the same layout (`levels` packs and
levels per pack, `daily`, `endless`), and its completeness gate compares the two files.

## Daily-only and endless-only games

A game with only a daily level (a daily puzzle) or only an endless run has no packs, but it still has
a `LevelsSpec`, because the host opens daily and endless runs from it (a module with `levels: null`
can open no run at all):

- **The contract entry** is `{ "id": "<game-id>", "packCount": 0, "levelsPerPack": 0, "daily": <bool>,
  "endless": <bool> }` with no `starRule` (there are no levels to rate) and at least one mode on
  (`levels-config` fails anything else). new-game-scaffold declares such a game with `levels: null`
  (no packs) and the same `daily` and `endless`.
- **The levels folder** holds `<game-id>-levels.ts` with `packs: []`, `table: []`, `solver: null` (or
  the game's solver, when hints use it), `difficultyFor` returning the daily difficulty, and only its
  modes; a test of it; and, with a daily level, the `[contract] <game-id> daily goldens` (three dates
  with a year-boundary pair) registered in `contracts/goldens.json`. No plan, no `pack-<n>.json`, no
  pack names: the checker skips `levels-file-missing` for them, the table and curve rules, `pack-name-key`,
  `levels-contract-test` and the plan run, and fails pack files left in the folder (`pack-config`).
- `levelsContractProblems` accepts `{ packCount: 0, levelsPerPack: 0 }` with an empty table, so a game
  that later gains packs keeps its test and only changes the entry, the plan and the packs.

## Pack layout and unlocking

`packsOf(plan)` (`level-kit/plan-level-table.ts`) builds the packs from the plan: consecutive level
ranges, `starsToUnlock = defaultStarsToUnlock(index, levelsPerPack)` = half of all stars of the packs
before it (0, 45, 90 for packs of 30). Pack ids are kebab-case (`'warm-up'`); pack names are catalog
keys numbered by pack (`'<game-id>.pack-name.1'`, `.2`, `.3`) present in every catalog of the app
(`pack-name-key`; `templates/src/i18n/catalogs/en.json` and `ar.json` hold the template's keys in
English and Arabic, and merge into the app's catalogs).

`level-kit/pack-progress.ts` holds the unlocking rules as pure functions over "best stars per completed
level":

| Function | Rule |
|---|---|
| `totalStars(stars)` | sum of best stars |
| `packOf(packs, level)` | the pack holding a level |
| `isPackUnlocked(pack, stars)` | total stars >= `starsToUnlock` |
| `isLevelUnlocked(packs, stars, level)` | its pack is unlocked, and it is the pack's first level or the level before it was won |
| `starsMissing(pack, stars)` | the "Collect n more stars" line of a locked pack |
| `nextLevel(table, level)` | the level after this one, or null (the result screen's "Next level") |

The levels screen reads these through its model hook (screen-contracts), never with its own numbers.

## Stars

`starsFor(rule, { isWon, moves, score })` (`level-kit/star-rating.ts`):

- a loss: 0 (only wins are recorded);
- `par` rule: 3 when `moves <= par`, 2 when `moves <= par + 2`, else 1;
- `score` rule `[win, two, three]`: `thresholds[0]` is the lowest score a win can have (0 when the win
  is not score-based); the game's `outcome` decides the win, so `starsFor` never reads it. 2 stars at
  `thresholds[1]`, 3 at `thresholds[2]`; three strictly ascending whole numbers. A witness game sets two
  at the witness's score and three above it (default: 20 % more, at least 1 more; a tuning number the
  developer approves): `scoreThresholds` in
  `examples/pig-levels/levels/pig-level-plan.ts`.

Moves count what the player kept: undone moves do not count (the host's move counter goes down on
undo). game-session-host calls `starsFor` at run end with the level's table entry and records the
result.

## The daily level

- `dailyStart(levels, dateKey)` (`level-kit/daily-start.ts`) returns
  `{ seed: dailySeed(dateKey, levels.daily.salt), difficulty: levels.daily.difficulty }`, or `null` for
  a game without a daily mode. The host calls `create(seed, difficulty)` with it.
- `dailySeed(date, salt)` (`src/core/dates/daily-seed.ts`, owned by seeded-determinism-and-golden-vectors)
  is FNV-1a over the `'YYYY-MM-DD'` key mixed with the salt; its goldens are a hard compatibility
  contract checked by that skill. Changing it, or a game's salt, changes every player's daily level
  between app versions.
- Pick each game's salt once and never change it: a 16-bit number no other game uses
  (`daily-salt-shared` fails a copy and prints the default). Default: FNV-1a of the game id folded to
  16 bits (`h = FNV-1a(id); (h ^ (h >>> 16)) & 0xffff`): `0x7c9e` for `lights-out`, `0x93cf` for `pig`.
  new-game-scaffold's scaffold plan prints this same default when the game has a daily level.
- Day boundaries belong to the app: "today" is `clock.today()` (the injected `ClockPort`, the local
  civil date) read on every focus; a daily run keeps the date it started with, so finishing after
  midnight records the day it was played. Streaks and the calendar on top of it belong to
  dates-streaks-and-statistics.

## Endless mode

`endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY }` for games that can run until the player
loses (Pig), exactly when the contract entry says `"endless": true` (`endless-mode`; the levels contract
test fails any other endless difficulty). The run is `create(freshSeed, ENDLESS_DIFFICULTY)`: the host
draws the fresh seed outside the rules and saves it with the run, so a resumed run replays exactly. The
tuning's endless row has no goal, and `outcome` never returns `won` at difficulty 100 (game-rules-engine's
contract test proves it with seeded random play): an endless run only ever ends lost. Endless has no
stars and no table entry; its result shows "New best!" whenever the score beats the stored best.

## Who uses what

| Consumer | Uses |
|---|---|
| Levels screen (screen-contracts) | `packs`, `table`, `isLevelUnlocked`, `starsMissing`, `totalStars` |
| Game and result screens (game-session-host) | the table entry (seed, difficulty, stars), `starsFor`, `dailyStart` (both synced into its templates), `nextLevel` |
| Daily card, streaks (dates-streaks-and-statistics) | `dailyStart` and the daily model |
| Hints | `rules.hints.suggest` built on the exact solver (`solvers.md`) |
| Tooling | the level plan, `planLevelTable`, `scripts/levels/generate-levels.ts` |
| Tests | `levelsContractProblems`, goldens, the solver properties |
