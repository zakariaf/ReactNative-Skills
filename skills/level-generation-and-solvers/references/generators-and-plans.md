# Generators, level plans and the generated tables

How a game's levels come into existence: the generator, the difficulty curve, the plan that picks
seeds and rates candidates, and the script that writes the committed `pack-<n>.json` files.

## Contents

- The pipeline
- Tuning first, packs second
- The generator is `create`
- Two ways to guarantee a good level
- The difficulty curve
- The level plan
- Choosing candidate seeds
- `rate()`: quality gates and star rules
- Games that draw at random: the witness (thresholds instead of par)
- Running the generator
- How the generator loads the app's TypeScript
- When the tables change
- When multi-package

## The pipeline

```
difficultyFor(level) --> create(seed, difficulty) --> solver.solve(start, maxNodes) --> rate(candidate)
      (curve)              (the engine's generator)    (exact par, or a witness win,    (StarRule or null)
                                  ^                     else the next attempt)                   |
             candidateSeed(gameId, level, attempt) <--- next attempt if rejected -------------------+
                                                                                                 v
     scripts/levels/generate-levels.ts writes src/games/<game-id>/levels/pack-<n>.json (the repo's Prettier)
```

Everything left of the file write is pure kit and game code (`planLevelTable`), so tests and the
checker can rerun it and compare with the committed files, value by value and byte by byte.

## Tuning first, packs second

A level is `create(seed, difficulty)` on the game's current tuning, so the tuning is settled before the
tables exist: the game's balance sims (game-balance-and-bots) pass first, then the packs are generated.
A tuning change after the packs exist (a knob, a row, a new piece) changes the boards behind every
level number: regenerate the packs, rerun the levels contract test, update the goldens one file at a
time after reading them, and commit with a `Gate-Change:` trailer. For a witness game the same holds for
a change to the policy or its seed. The checker's `pack-stale` is what catches a forgotten regeneration.

## The generator is `create`

`GameEngine.create(seed, difficulty)` is the level generator. There is no second generator for levels,
dailies or endless runs: a level is its seed and difficulty. A game may keep the construction in its own
module (`rules/generate-board.ts`, called by `create`) when it grows, but the engine function stays the
entry point, and it follows the determinism policy (seeded `sfc32`, exact arithmetic).

## Two ways to guarantee a good level

1. **Construct from a solution (preferred when possible).** Start from a solved position and apply
   seeded reverse moves or presses (the Lights Out template scrambles a dark board with `presses`
   seeded presses). Every level is solvable by construction and par is at most the number of scramble
   steps. The solver still computes the exact par.
2. **Generate and test.** Place pieces from the seed with the game's constraints, then let the plan's
   solver prove it winnable; unsolvable or over-budget candidates are skipped and the next seed is
   tried. Needed for games whose moves cannot be reversed (sliding groups that stop at walls, tiles that
   change under a move).

Either way, `create` accepts any difficulty 0..100 (clamp with `clampDifficulty`), and
`outcome(create(...))` is `playing`.

A third case is a game that draws its future during play (Pig rolls a die from its stream). No search
over a fixed future exists, so each candidate is proven by a witness instead (below).

## The difficulty curve

`difficultyFor(level)` maps level 1..N to 0..99 and never falls (`difficulty-curve` fails a table whose
difficulty drops from one level to the next, `pack-json` any level above 99: 100 is the endless run). It
starts at 0 on level 1 and rises to its cap at the last level. The cap is `MAX_LEVEL_DIFFICULTY` (99)
unless the solver can only prove easier levels: the Lights Out template stops at
`LEVEL_DIFFICULTY_CAP = 60`. Pig uses the whole scale. The daily difficulty (40 to 50) and the endless
difficulty (100) sit on the same scale; `levels-model.md` shows how the curve walks through the tuning
rows.

Within the curve, `create` turns difficulty into the game's knobs (grid size, pieces, a target, a move
limit) through the tuning table (`knobsFor` with `rowFor`). Keep each knob monotonic in difficulty.

## The level plan

`src/games/<game-id>/levels/<game-id>-level-plan.ts` exports one `LevelPlan<State, Move>`
(`level-kit/level-plan.ts`):

| Field | Meaning |
|---|---|
| `gameId` | kebab-case id; part of every candidate seed, so two games never share boards |
| `packs` | `[{ id, nameId }]` in order; pack n holds levels (n-1) x levelsPerPack + 1 ... |
| `levelsPerPack` | equals the game's `levelsPerPack` in `contracts/levels.json` |
| `difficultyFor` | the curve (also used as `LevelsSpec.difficultyFor`) |
| `create` | the engine's `create` |
| `solver` | the game's exact solver, or `createWitnessSolver(...)` for a game that draws during play (never null) |
| `maxNodes` | solver budget per candidate (a witness: the legal moves its player may be shown); over budget = skipped |
| `maxTries` | candidates per level before the plan reports a failure |
| `rate(candidate)` | a `StarRule` for a good level, `null` to reject it |

`<game-id>-levels.ts` then assembles the `LevelsSpec` from the plan (`packsOf(plan)`, `difficultyFor`)
and the committed packs (`toLevelEntries`).

## Choosing candidate seeds

`candidateSeed(gameId, level, attempt) = hashSeed('<gameId>:level:<level>:<attempt>')`. Consequences:

- the table is identical on every machine and after every regeneration while the plan and the engine
  are unchanged;
- renaming the game id or changing `create` changes every level: regenerate, read the goldens, and
  commit with a `Gate-Change:` trailer (see "When the tables change");
- the planner also skips a candidate whose start state equals an earlier level's (no duplicate boards);
- `Math.random` or the clock never picks a seed (`determinism`): the table would differ on every run.

## `rate()`: quality gates and star rules

`rate({ level, seed, difficulty, start, par, line, final })` is where the game's level quality rules
live. `par` is the solver line's length, `line` the proof and `final` the state it ends in (a score
rule reads the score there without a replay):

- **No trivial levels:** reject `par` below a minimum that rises by pack (template: 2, 3, 4). Only the
  first three levels may be won in one move (`trivial-level`).
- **Not too hard for the pack:** reject a par above the band approved for that pack, or rely on
  `maxNodes` (a board the solver cannot finish within budget is skipped).
- **Game-specific shape rules:** at least one piece in reach, no piece already on its goal, a minimum
  number of lit cells.
- Return `{ kind: 'par', par }` for puzzle games; the recorded par is exactly the solver's (the contract
  test re-solves every level and compares).

`par-curve` fails when a later pack's average par is below an earlier pack's. The bands (minimum par per
pack, the cap) are a design decision: write them into the plan with the developer's numbers, and the
checker's `--report` lines show the result per pack.

## Games that draw at random: the witness (thresholds instead of par)

Games rated by score have no exact par, and games that draw their future from the RNG have no exact
search either. Their winnability is proven by a **witness**: the game's reasonable player plays the
level, and its win is the proof (`solvers.md`).

- **The solver** is `createWitnessSolver({ rules: <GAME_CONST>_ENGINE, policy, botSeed })`; Pig:
  `holdAtTwentyPolicy` from `rules/pig-hold-policy.ts` and `WITNESS_BOT_SEED`. A lost candidate is
  `budget-exceeded`, which `planLevelTable` treats as a retry with the next seed, so a witness plan
  needs a larger `maxTries` (Pig 60).
- **`rate`** rejects levels the witness wins too quickly (Pig: fewer than `MIN_WITNESS_MOVES` = 12; this
  is all `par` is used for, and it is never shown) and returns `{ kind: 'score', thresholds: [win, two, three] }`:
  - `win` = `thresholds[0]`, the lowest score a win can have (Pig: the target, because a win banks at
    least the target; 0 for a game whose win is not score-based);
  - `two` = the witness's final score (at least `win + 1`): what a reasonable player reaches;
  - `three` = `two` plus a margin for clearly better play (default 20 %, at least 1 more; the margin is
    a tuning number the developer approves, not a library rule).
- **The contract test** re-runs the witness for every level and replays its line with `verifyLine`; a
  level whose witness no longer wins fails.
- **Fixed forever:** the bot seed and the policy. Changing either (or the tuning) regenerates the
  packs, with a `Gate-Change:` trailer.

`examples/pig-levels/` is the complete worked example (solver, plan with `scoreThresholds`, describe,
`LevelsSpec` with a daily and an endless run, tests, golden snapshot, contract entry).

## Running the generator

Copy the plan and the generator scripts; generate the packs for your game (the template's packs belong
to the template game and fail `pack-stale` for any other game id or plan):

```sh
# write src/games/<game-id>/levels/pack-1.json ... (one per pack)
node scripts/levels/generate-levels.ts --game <game-id>
# compare only: exits 1 and names the packs whose bytes differ
node scripts/levels/generate-levels.ts --game <game-id> --check
npx prettier --check src/games/<game-id>/levels
```

The generator runs `planLevelTable`, prints failures (a level with no accepted candidate) and exits 1 on
any failure, writing nothing. It formats every pack through the repo's own Prettier (`resolveConfig`
for the pack's path, the `json` parser), so short arrays such as score thresholds are written
`[0, 150, 180]` exactly as `prettier --check` wants them, and `--check` compares those bytes. That is
why a pack is never formatted by hand and never listed in `.prettierignore`: the two checks can only
disagree when someone edits the file. `check-levels.mjs` makes the same comparison (`pack-stale` for
different levels, `pack-format` for different bytes; without an installed Prettier it uses Prettier's
JSON layout with the repo's `printWidth`). A game outside `src/games` passes `--games-dir <dir>`, and
an app whose `@/` alias points somewhere other than `src/` passes `--src-dir <dir>` (the same folders
the checker reads from `gamesDir` and `srcDir` in `rn-skills.config.json`). `--help` prints the usage;
a usage error prints one line and exits 2. Commit the packs it wrote, then run the levels tests and the
goldens.

## How the generator loads the app's TypeScript

Node 22.18 and newer strip TypeScript types, but the app's code imports `@/core/...` and siblings
without an extension, which Node does not resolve. `scripts/levels/app-imports.ts` registers
`module.registerHooks` (Node 22.15+, still marked experimental in the docs of Node 26; verified on
2026-10-14 with Node 26.4: `node -e "import('node:module').then((m) => console.log(typeof m.registerHooks))"`
prints `function`): `@/x` resolves to `src/x`, an extensionless import is probed like Metro and
TypeScript probe it, `.ts` under `src/` loads as a TypeScript module and `.json` as a default export.
`generate-levels.ts` registers the hooks first and only then imports `run-level-plan.ts`, and
`run-level-plan.ts` loads both the kit (`plan-level-table.ts`) and the game's plan with `await import()`
of a file URL it builds at run time. Why dynamic: a static value import of `src/` would be evaluated
before the hooks exist (and fail on the kit's `@/core/rng/sfc32` import), and
architecture-and-boundaries' `check-boundaries.mjs` rejects any value import from a Node script into
`src/` code that imports through an alias (`node-import`), even a literal `import('../../src/...')`.
Its types come in through `import type`, which Node erases and the boundary rule allows. A plan that
imports React Native or Expo fails to load (`plan-run`), which is the purity the level code needs
anyway.

Troubleshooting:

- `Cannot find module '.../src/...'` from the generator: the plan imports a file outside `src/`, or a
  tsconfig alias other than `@/` (extend `appImportBase` in `app-imports.ts` for it).
- `MODULE_TYPELESS_PACKAGE_JSON` warning: a file is loaded without the hooks (it lives outside `src/`);
  the repo's `scripts/package.json` (`"type": "module"`) covers scripts, the hooks cover `src/`. Never
  add `"type"` to the app's root `package.json` for this: Metro and the Expo config read it.
- `level N: no candidate in M tries`: loosen `rate()` for that band, raise `maxTries` or `maxNodes`, or
  lower the difficulty there; rerun until there are 0 failures.

## When the tables change

A changed pack file means players get different levels. That is fine before the game ships and a
deliberate decision after:

1. Regenerate with the script (never edit a pack file by hand; `check-levels.mjs` regenerates and fails
   on any difference, `pack-stale` or `pack-format`). A tuning change, a changed `create`, a new witness
   seed or policy all count.
2. Run the levels contract test (every level proven by a replayed line, at its par for par levels) and
   the goldens with `-u` only for the files that should change; open the new snapshots and look at the
   boards.
3. Commit with a `Gate-Change: <why the levels changed>` trailer (git-commits-and-reporting; ask
   quality-gates to list `src/games/*/levels/pack-*.json` in `gatedPaths` so the trailer is enforced).
   After release, stop and ask the developer first: saved runs keep their own seed and difficulty, but
   players see different boards under the same level numbers.

Daily levels are different: the daily seed and the generator for existing dates never change (see
`goldens-and-quality.md`).

## When multi-package

With npm workspaces the games and the kit may live in packages (`packages/games/src/<game-id>/levels`,
`packages/core/src/game`). Run the generator from the app folder with `--games-dir`, extend
`appImportBase` for the workspace package names (`@<org>/core/x`), and run `check-levels.mjs` once per
app with the app folder as the root and `--games-dir`, `--core-dir` (or the `rn-skills.config.json`
keys `gamesDir` and `coreDir`).
