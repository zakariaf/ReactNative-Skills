# check-levels.mjs: options, rules and troubleshooting

`node ${CLAUDE_SKILL_DIR}/scripts/check-levels.mjs [repo-root] [options]` checks the level kit, its
prerequisites, the generator scripts and every game's levels folder, statically and by running the
real code (the star rule and a regeneration of every plan). It prints `FAIL <file>:<line> [<rule>]
<message> Fix: <fix>` lines and ends with `RESULT: PASS` or `RESULT: FAIL (<n> problems)`; exit 0, 1, or
2 for bad input.

## Contents

- Options and configuration
- What it checks, and when
- Rules
- Expected SKIP and NOT APPLICABLE lines
- When multi-package
- Troubleshooting

## Options and configuration

| Option | Config key (`rn-skills.config.json`) | Default |
|---|---|---|
| `--game <id>` (repeatable) | | every `<gamesDir>/<id>` with a `levels/` folder, and every game in the levels contract |
| `--games-dir <dir>` | `gamesDir` (shared with game-rules-engine) | `<srcDir>/games` |
| `--core-dir <dir>` | `coreDir` (check-lib layout key) | `src/core` |
| `--contract <file>` | `levelsContract` | `<contractsDir>/levels.json` |
| `--catalogs-dir <dir>` | `gameCatalogsDir` (shared with game-rules-engine) | `<i18nDir>/catalogs` |
| `--generator-dir <dir>` | `levelsGeneratorDir` | `<scriptsDir>/levels` |
| `--report` | | off: print per-pack metrics |
| `--no-run` | | off: skip the star rule run and the plan regeneration |
| `--json` | | off: also print the problems as one JSON line |

tsconfig `paths` resolve `@/` imports for the import zone and for the runs; `contracts/goldens.json`
`contractMarkers` (golden-and-snapshot-tests) names the daily contract marker (default `[contract]`).

## What it checks, and when

1. Exit 2 (`ERROR [bad-input] nothing to check: <root> has no package.json`) when the root is not an
   app repo root, so a run from the wrong folder never looks like a pass; NOT APPLICABLE when it is an
   app with no levels at all (below).
2. The kit (`<core>/game/solver/*`, `level-kit/*`, `testing/render-cells.ts`), the generator scripts and
   the prerequisites, whenever there is a game with levels or the kit exists.
3. The star rule, by importing the real `star-rating.ts` (Node type stripping; a module that imports
   React Native or Expo cannot load).
4. The levels contract and, per game: packs, table, modes, goldens, the contract test, the import zone,
   determinism, placeholders, pack name keys, then a regeneration of the plan compared with the packs.
5. Daily salts across every game of the app.

## Rules

| Rule | Fails when | Fix |
|---|---|---|
| `kit-file-missing` / `kit-export-missing` | a level kit file or generator script is missing, or an older copy lacks an export | copy it from `templates/` |
| `kit-prerequisite` | `<core>/game/{levels,difficulty,game-engine,messages}.ts`, `game/testing/play-bot.ts` (game-rules-engine) or `<core>/rng/sfc32.ts`, `dates/{date-key,daily-seed}.ts` (seeded-determinism-and-golden-vectors) is missing or older (no `final` in `SolveResult`) | install them with their owner skills |
| `kit-test-dependency` | the kit or levels tests import fast-check without an exact root `devDependencies` pin | `npm install -D -E fast-check@4.10.2` |
| `star-rule` | the real `starsFor` breaks the formula (par 7: 7 moves 3 stars, 9 moves 2, 10 moves 1, a loss 0; thresholds [100, 250, 400]: 249 gives 1, 250 gives 2, 400 gives 3) | restore `star-rating.ts` |
| `levels-config` | the contract is missing while a game has levels, is malformed, or lacks a game's entry; a pack-less entry (`packCount` 0) with `levelsPerPack` other than 0, a `starRule`, or no mode on | follow `templates/contracts/levels.schema.json` |
| `levels-file-missing` | `<id>-levels.ts`, `<id>-level-plan.ts` or `pack-1.json` is missing, or a contract game has no `levels/` | copy the templates, run the generator |
| `pack-json` | a pack is not a JSON array of valid entries (uint32 seed, difficulty 0..99, par >= 1 or three ascending thresholds) | regenerate |
| `level-numbering` / `pack-size` / `pack-config` | levels are not 1..n across packs, packs differ in size, or differ from the contract (count, size, star rule); pack files in a game the contract declares pack-less | fix the plan or the contract, regenerate |
| `duplicate-level` / `difficulty-curve` / `trivial-level` / `par-curve` | quality metrics (`goldens-and-quality.md`) | fix `rate()` or the curve, regenerate |
| `solver-required` | par-rated levels but `solver: null` | add the exact solver |
| `daily-mode` / `endless-mode` | the contract and the `LevelsSpec` disagree, or the daily has no salt | make them agree |
| `daily-salt-shared` | two games use the same daily salt (usually the template's copied); the fix prints both games' default salts | give the newer game its own salt |
| `pack-name-key` | a pack `nameId` of the plan is missing from a catalog | add it to every catalog |
| `levels-contract-test` | no test runs `levelsContractProblems` | copy the levels test |
| `level-golden` / `golden-snapshot-missing` | no golden test, or no committed snapshot | copy the golden test, `-u` once, read it |
| `daily-golden` / `daily-golden-contract` | no `*.golden.test.ts` calls `dailyStart(` or `dailySeed(`, or it quotes fewer than three `YYYY-MM-DD` dates or no year-boundary pair; no contract marker in the daily describe; the daily golden test is not listed in `contracts/goldens.json` `contracts` (SKIP before that file exists) | pin the dates as literals with `dailyStart(levels, date)`; title `[contract] <id> daily goldens` and register it |
| `pure-import` | a level file imports React Native, Expo, `node:`, another game, the game's `testing/`, or app code outside `<core>` and the game's `rules/`, `levels/`, `geom/` | move the code into `rules/` or `src/core` |
| `determinism` | `Math.random`, `Date.now`, `new Date`, `performance.now` (tests too), or `**`, `Intl`, `toLocale*`, `localeCompare`, inexact `Math.*` (non-test code) | exact arithmetic and the seeded RNG |
| `placeholder-left` | a `__GAME_*__` placeholder remains in a levels file | rename everything for the game |
| `plan-run` / `plan-failure` | the plan cannot load headless, or a level has no accepted candidate (one problem per game: the first failing level, then the count and the next few; the packs are not compared) | fix the import or loosen the band |
| `pack-stale` / `pack-format` | the committed levels differ from what the plan generates, or the bytes differ from the generator's Prettier output | regenerate with the script |

`dailySeed`'s own golden values are not checked here: seeded-determinism-and-golden-vectors'
`check-determinism.mjs` runs them.

## Expected SKIP and NOT APPLICABLE lines

- `NOT APPLICABLE: the app has no levels (no src/games/<game-id>/levels/, no contracts/levels.json and no src/core/game/solver or src/core/game/level-kit)`
  for an app without games or before the first level work (the reference app prints this).
- `SKIP src/i18n/catalogs [pack-name-key] not yet created (i18n-strings-and-catalogs creates it)` before
  the app has catalogs.
- `SKIP contracts/goldens.json [daily-golden-contract] not yet created (golden-and-snapshot-tests creates it)`
  before the goldens register exists.

No other SKIP: a missing kit file, contract, golden or pack is a problem once a game has levels.

## When multi-package

Run once per app with the app folder as the repo root, and point `--games-dir` and `--core-dir` (or the
config keys) at the workspace folders; tsconfig `paths` and package.json `workspaces` resolve the
imports for the runs.

## Troubleshooting

- `plan-run ... Cannot find package 'react-native'`: a file the plan imports (often through the solver
  or a shared helper) imports React Native or Expo. Level code is pure; move the helper into `src/core`
  or the game's `rules/`.
- `pack-stale` right after copying the templates for a new game: expected. The template's packs belong
  to `lights-out`; run the generator for your game id.
- `pack-format` with the right levels: the pack was reformatted (an editor, `JSON.stringify`, a merge
  tool). Regenerate; never add packs to `.prettierignore`.
- The run is slow: the checker regenerates every plan. `--no-run` skips the runs for a quick static
  pass; the definition of done needs the full run.
- `daily-mode` / `endless-mode` says a mode is off although the `LevelsSpec` turns it on, or
  `pack-name-key` misses a key you wrote: these rules read the source with patterns, not a type
  checker. They see `daily: { kind: 'daily', ... }`, `endless: { kind: 'endless', ... }` and
  `nameId: '...'` written inline with single quotes (the canonical Prettier and the templates write
  them so). A hoisted constant (`daily: MY_DAILY_MODE`) or double-quoted strings hide the facts; write
  the modes and the nameIds inline in the `LevelsSpec` and the plan.
