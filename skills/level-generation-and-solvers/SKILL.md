---
name: level-generation-and-solvers
description: "Generates level tables proven winnable by a solver or witness bot: par, stars, pack unlocks, a daily level. Use when adding levels, a solver, par, stars, packs or daily levels. Not for game rules (game-rules-engine)."
---

# Level generation and solvers

Gives every game a shipped level table that is generated from seeds, proven winnable (by an exact
solver at a recorded par, or, for games that draw their future at random, by a witness bot), laid out
in packs that unlock by stars, pinned by data goldens, and a daily level that is the same on every
iPhone and Android phone with no server. A checker regenerates each table from the game's plan and
fails on any difference in values or bytes, a bad curve, an import outside the levels zone or a missing
golden.

## Rules that must hold

1. **Levels are generated, never drawn:** a level is `{ level, seed, difficulty, stars }` and its board
   is the engine's `create(seed, difficulty)`, with level and daily difficulties on 0..99 (100 is the
   endless run). Why: the same seed gives the same level everywhere, the tables stay tiny and saved
   progress replays exactly.
2. **`pack-<n>.json` files are written only by `scripts/levels/generate-levels.ts` from the game's
   `LevelPlan`, through the repo's Prettier;** the committed bytes equal what the plan generates. Never
   edit, hand-format, copy or `.prettierignore` a pack. Why: a hand-edited table drifts from the
   generator, and the checker regenerates and compares values (`pack-stale`) and bytes (`pack-format`).
3. **Every shipped level is proven winnable and its proof line is replayed through the real engine
   (`verifyLine`):** par games by an exact solver at the recorded par; games that draw during play by
   `createWitnessSolver`, the game's reasonable player from a fixed bot seed. `budget-exceeded` is never
   `unsolvable`. Why: "no level is impossible", and a solver is never trusted on its own.
4. **One star formula, `starsFor`:** par levels 3 stars at or under par, 2 up to par + 2, 1 for
   finishing; score levels `[win, two, three]`, three ascending whole numbers, `thresholds[0]` the
   lowest winning score, a witness game's two stars at the witness score and three above it (default:
   20 % more, at least 1); a loss is 0. Why: the result and levels screens show these stars to every
   player.
5. **The difficulty curve never falls, later packs are never easier, and no level after the third is a
   one-mover;** the plan's `rate()` enforces the bands while generating. Why: players expect the game
   to rise; the checker reads the generated table (`difficulty-curve`, `par-curve`, `trivial-level`).
6. **The daily level is `create(dailySeed(dateKey, salt), dailyDifficulty)` with a 16-bit salt no other
   game uses and a daily difficulty the developer approves (default: medium, 40 to 50), both fixed
   forever once shipped;** "today" comes from
   the injected clock at the edge. Why: every player gets the same daily level on the same date, and a
   changed salt changes it for everyone.
7. **Data goldens pin the pack boundary levels and at least three daily dates (a year-boundary pair
   included) in a `[contract] <game-id> daily goldens` describe registered in `contracts/goldens.json`;
   snapshots are committed and change only with `-u` on one file and a `Gate-Change:` trailer.** Why: a
   silent generator or tuning change would give players different boards under the same level numbers.
8. **`contracts/levels.json` declares each game's `packCount`, `levelsPerPack`, `starRule`, `daily` and
   `endless`, and the packs, the `LevelsSpec` and the contract test agree with it;** the first pack
   needs 0 stars and later packs exactly half the stars of the packs before them (0, 45, 90 for packs
   of 30). A daily- or endless-only game is an entry with `packCount` 0, `levelsPerPack` 0 and no
   `starRule`. Why: one place says what the game ships, so the table and the modes can never disagree.
9. **Level code is pure and deterministic:** files in `src/games/<game-id>/levels/` import only
   `src/core` and the game's own `rules/`, `levels/` and `geom/` (never `testing/`: a witness's policy
   lives in `rules/`), and use no `Math.random`, clock, `**`, `Intl` or inexact `Math`. Why: Jest, the
   generator, Hermes on iOS and Hermes on Android must generate bit-identical levels.
10. **Pack names are catalog keys present in every catalog of the app.** Why: the levels screen shows
    them in the user's language, left to right or right to left.
11. **Tuning first, packs second:** the balance sims pass before the packs are generated, and any
    later change to the tuning, `create`, the solver or the witness regenerates the packs and goldens;
    after release, stop and ask the developer before players' levels change. Why: every level is
    `create(seed, difficulty)` on the current tuning.

## Workflow

1. **Settle the tuning, then read [references/levels-model.md](references/levels-model.md)** (types,
   the curve and the tuning rows, the contract, packs, stars, daily, endless). The game's balance sims
   (game-balance-and-bots) pass first. Ask the developer for the bands: packs and levels per pack,
   minimum par per pack, star rule (par or score), daily difficulty, an endless run; defaults are
   3 x 30, minimum par 2/3/4, par stars, daily 40 to 50, no endless run.
2. **Install the level kit once per app.** The game kit and the RNG come first: game-rules-engine
   (`src/core/game/*.ts`, `testing/play-bot.ts`) and seeded-determinism-and-golden-vectors
   (`src/core/rng/sfc32.ts`, `src/core/dates/{date-key,daily-seed}.ts`). Pin fast-check exactly
   (`npm install -D -E fast-check@4.10.2`; verified on 2026-10-03, re-verify with
   `npm view fast-check version`). Run `node ${CLAUDE_SKILL_DIR}/scripts/check-levels.mjs .`; for each
   `kit-file-missing` copy the file from `templates/` to the path its first line names, with its test:
   `src/core/game/solver/`, `src/core/game/level-kit/`, `src/core/game/testing/render-cells.ts` and
   `scripts/levels/`. `templates/src/core/game/*.ts`, `testing/play-bot.ts` and
   `templates/src/games/__GAME_ID__/rules/` are synced copies of game-rules-engine's files, there only
   so the templates compile alone: never copy them over the app's own.
3. **Write the solver test-first.** Read [references/solvers.md](references/solvers.md). A game whose
   whole future is fixed by `create` gets an exact search: copy
   `templates/src/games/__GAME_ID__/levels/__GAME_ID__-solver.ts` and its test to
   `src/games/<game-id>/levels/` (rename files; replace `__GAME_ID__`, `__GAME_PASCAL__`,
   `__GAME_CONST__`), choose the search state, move order and key, BFS or IDA*, and prove it with
   examples, the `verifyLine` property and a budget test. A game that draws during play uses
   `createWitnessSolver` with its policy in `rules/`: imitate `examples/pig-levels/`.
4. **Write the level plan test-first.** Read [references/generators-and-plans.md](references/generators-and-plans.md).
   Copy `__GAME_ID__-level-plan.ts` and its test: packs, the curve (`difficultyFor` from 0 at level 1 to
   its cap), the budget, and `rate({ level, par, line, final })` with the bands (a witness game:
   `scoreThresholds` from the final score, a minimum witness length).
5. **Declare the game in `contracts/levels.json`** (copy `templates/contracts/levels.json` and
   `levels.schema.json` once; one entry per game; a daily- or endless-only game has `packCount` 0 and
   skips the plan and packs: levels-model.md, "Daily-only and endless-only games"). Merge the pack name keys of
   `templates/src/i18n/catalogs/en.json` and `ar.json` (English and Arabic examples) into every catalog
   the app ships, with your game id and pack names, and send the texts through the app's review queue
   (i18n-strings-and-catalogs owns the catalogs).
6. **Generate the tables:** `node scripts/levels/generate-levels.ts --game <game-id>` writes
   `pack-<n>.json` through the repo's Prettier. Fix any `level N: no candidate` by loosening the band or
   the curve, rerun until 0 failures. Then `node scripts/levels/generate-levels.ts --game <game-id> --check`
   and `npx prettier --check src/games/<game-id>/levels` both exit 0. Commit exactly what it wrote.
7. **Assemble and prove the table.** Copy `__GAME_ID__-levels.ts` (the `LevelsSpec`: plan, packs,
   `toLevelEntries`, solver, daily salt and difficulty, endless) with the game's own salt (the
   template's `0x7c9e` is `lights-out`'s; `daily-salt-shared` prints the default for your id) and
   `__GAME_ID__-levels.test.ts` (runs `levelsContractProblems` with the contract entry as `CONFIG`). Set
   `levels` in `src/games/<game-id>/<game-id>-game.ts` (game-rules-engine's module) to it. A puzzle
   game with hints wires `hints: { kind: 'solver', suggest }` in its rules (never for a witness).
8. **Pin the goldens.** Read [references/goldens-and-quality.md](references/goldens-and-quality.md).
   Copy `__GAME_ID__-describe.ts` (with its test) and write `describeLevel(state)` for the game. Copy
   `__GAME_ID__-levels.golden.test.ts`, delete the template's `.snap.ios`, run
   `npx jest src/games/<game-id>/levels/<game-id>-levels.golden.test.ts --selectProjects golden -u`
   once, open the `.snap.ios` and read the boards, register the test in `contracts/goldens.json`
   `contracts` (golden-and-snapshot-tests), then `npx jest src/games/<game-id>/levels --ci --selectProjects golden`
   passes.
9. **Format, lint, type-check, test:** `npx eslint --fix src/games/<game-id>/levels src/core/game scripts/levels`,
   `npx prettier --write src/games/<game-id>/levels`, `npm run typecheck`, then
   `npx jest src/games/<game-id>/levels src/core/game scripts/levels --ci --selectProjects unit --coverage --collectCoverageFrom='src/core/game/**/*.ts' --coverageThreshold='{}'`
   and read the table (`src/core` stays at 95/95/95/90; paths before `--selectProjects`, which reads
   every later word as a project name).
10. **Run the check** `node ${CLAUDE_SKILL_DIR}/scripts/check-levels.mjs . --game <game-id> --report`;
    fix every `FAIL` line (file, rule, fix) and rerun until it prints `RESULT: PASS`. Rules, options
    and troubleshooting: [references/checker.md](references/checker.md). Put the `--report` pack lines
    in the report and commit tables and goldens with a `Gate-Change:` trailer (git-commits-and-reporting).

## Definition of done

- [ ] The balance sims passed before the packs were generated (or the packs were regenerated after the
      last change to the tuning, `create`, the solver or the witness).
- [ ] The root `package.json` pins `fast-check` exactly; `src/core/game/solver/`, `level-kit/`,
      `testing/render-cells.ts` and `scripts/levels/` are installed with their tests, on top of the game
      kit and the RNG and date keys from their owner skills.
- [ ] `contracts/levels.json` lists the game; its pack name keys are in every catalog.
- [ ] `src/games/<game-id>/levels/` has the solver, the plan, `describeLevel`, the `LevelsSpec`, one
      generated `pack-<n>.json` per pack and their tests; `generate-levels.ts --game <game-id> --check`
      and `npx prettier --check src/games/<game-id>/levels` exit 0; no `__GAME_` placeholder is left.
- [ ] `<game-id>-levels.test.ts` runs `levelsContractProblems` and returns `[]` (every level proven by a
      replayed line, at its par for par levels; packs matching the contract; endless at 100 exactly
      when the contract says so).
- [ ] The golden test pins the pack boundary levels and three daily dates with a year-boundary pair in a
      `[contract]` describe; the test is listed in `contracts/goldens.json` `contracts` (golden-and-
      snapshot-tests' check passes too); its `.snap.ios` was read and committed with a `Gate-Change:`
      trailer.
- [ ] `npm run typecheck`, `npx eslint --max-warnings 0`, `npx prettier --check` and
      `npx jest <paths> --ci --selectProjects unit` and `--selectProjects golden` pass.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-levels.mjs . --game <game-id>` prints `RESULT: PASS`

A passing run may print `SKIP src/i18n/catalogs [pack-name-key] not yet created (i18n-strings-and-catalogs creates it)`
before the app has catalogs, and `SKIP contracts/goldens.json [daily-golden-contract] not yet created (golden-and-snapshot-tests creates it)`
before the goldens register exists. An app without levels prints
`NOT APPLICABLE: the app has no levels (no src/games/<game-id>/levels/, no contracts/levels.json and no src/core/game/solver or src/core/game/level-kit)`.

## Anti-patterns

- **Editing a pack file to "fix" one level.** The next regeneration undoes it and `pack-stale` fails;
  change the plan or `create` and regenerate.
- **Copying the template's packs or snapshot for a new game.** They belong to `lights-out`; generate the
  packs and write the snapshot with `-u` for your game id.
- **Raising a test's node budget until a level passes.** A level the solver cannot prove within the
  plan's budget should never have been accepted; regenerate or improve the key and move order.
- **Treating `budget-exceeded` as unsolvable** (or the reverse). Only `unsolvable` means the whole space
  was searched.
- **A heuristic that overestimates "to be faster".** IDA* then returns a longer line than par and
  players beat par; keep it admissible, or use 0.
- **Changing a game's daily salt, the daily difficulty or `dailySeed`.** Every player's daily level
  changes between versions; ask the developer first.
- **`jest -u` over a whole folder or in a script.** Goldens change one file at a time, after reading the
  new boards.
- **`Math.random` or the clock to pick candidate seeds.** Tables must regenerate identically; seeds come
  from `candidateSeed(gameId, level, attempt)`.
- **Ad-hoc star numbers in a screen.** Stars come from the table's `StarRule` through `starsFor`.
- **Formatting packs by hand or adding them to `.prettierignore`.** `prettier --check` and
  `generate-levels --check` then disagree; run the generator.
- **`solver: null` or bot sims instead of a proof for a game that draws at random.** Prove each level
  with `createWitnessSolver`; a lost witness is a retry with the next seed, never `unsolvable`.
- **Importing the bot from `testing/` into a level file.** It breaks the levels zone (`pure-import`);
  keep the policy in `rules/` and let `testing/` re-export it.
- **Generating the packs before the tuning is settled.** Every later tuning change regenerates the packs
  and their goldens; run the balance sims first.
- **Adding `"type"` to the app's root `package.json` to silence a Node warning.** The generator's hooks
  load `src/` as TypeScript modules; Metro and the Expo config read the root manifest.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/levels-model.md](references/levels-model.md) | Defaults, the types, the difficulty scale, the levels contract, packs and unlocking, stars, the daily level, endless, who uses what | Workflow step 1 |
| [references/solvers.md](references/solvers.md) | The search kit, custom problems and keys, BFS or IDA*, heuristics, budgets, the witness solver, `verifyLine`, hints, solver tests | Step 3 |
| [references/generators-and-plans.md](references/generators-and-plans.md) | The pipeline, tuning first, generator strategies, curve, `LevelPlan`, candidate seeds, `rate()`, witness games, running the generator, how it loads the app's TypeScript, changing tables, multi-package | Steps 1, 4 and 6 |
| [references/goldens-and-quality.md](references/goldens-and-quality.md) | Data goldens and `describeLevel`, the `-u` policy, the daily contract, the levels contract test, the quality metrics | Steps 7 and 8 |
| [references/checker.md](references/checker.md) | The checker's options, config keys, every rule, expected SKIP and NOT APPLICABLE lines, multi-package, troubleshooting | Step 10, when a line is unclear |
| `templates/src/core/game/solver/` | `search-problem`, `bfs-solve`, `ida-star-solve`, `engine-solver`, `verify-line`, `witness-solver`, with tests | Step 2 |
| `templates/src/core/game/level-kit/` | `level-table`, `levels-contract` (replays every proof line), `pack-progress`, `star-rating` (the one star formula) and `daily-start` (the one daily seed and difficulty), both with canonical copies synced into game-session-host too, `level-plan`, `plan-level-table`, with tests | Step 2 |
| `templates/src/core/game/testing/` | `render-cells.ts` (text boards for goldens) with its test | Step 2 |
| `templates/scripts/levels/` | `generate-levels.ts` (the CLI), `run-level-plan.ts` (plan, Prettier, write or compare), `app-imports.ts` (Node module hooks for `@/` and extensionless imports), with tests | Steps 2 and 6 |
| `templates/contracts/` | `levels.json` (one entry per game) and `levels.schema.json` | Step 5 |
| `templates/src/games/__GAME_ID__/levels/` | The template game (Lights Out): exact solver, plan, `describeLevel`, `LevelsSpec`, unit, contract and golden tests, its generated packs and golden snapshot (for `lights-out` only) | Steps 3 to 8 |
| `templates/src/i18n/catalogs/` | `en.json` and `ar.json` holding only the template's three `__GAME_ID__.pack-name.N` keys, merged into the app's catalogs | Step 5 |
| `templates/src/core/game/levels.ts` | Synced copy of game-rules-engine's kit file, there so the templates compile alone (assets/shared.json; never edit here, never copied over the app's own) | Never by hand |
| `templates/src/core/game/difficulty.ts` | Synced copy of game-rules-engine's kit file, there so the templates compile alone (assets/shared.json; never edit here, never copied over the app's own) | Never by hand |
| `templates/src/core/game/game-engine.ts` | Synced copy of game-rules-engine's kit file, there so the templates compile alone (assets/shared.json; never edit here, never copied over the app's own) | Never by hand |
| `templates/src/core/game/messages.ts` | Synced copy of game-rules-engine's kit file, there so the templates compile alone (assets/shared.json; never edit here, never copied over the app's own) | Never by hand |
| `templates/src/core/game/testing/play-bot.ts` | Synced copy of game-rules-engine's kit file, there so the templates compile alone (assets/shared.json; never edit here, never copied over the app's own) | Never by hand |
| `templates/src/games/__GAME_ID__/rules/` | Synced copies of game-rules-engine's Lights Out rules (types, tuning, create, toggle-cells, list-moves, outcome, apply-move) the level templates import (assets/shared.json; never edit here) | Never by hand |
| `examples/pig-levels/` | Pig, a dice game that draws during play: the witness policy in `rules/` (a synced copy of game-rules-engine's Pig `rules/pig-hold-policy.ts`), witness solver, score-rated plan, `describeLevel`, a `LevelsSpec` with daily and endless, tests, golden snapshot, contract entry | Steps 3 to 8, for a game that draws during play |
| [assets/template-placeholders.json](assets/template-placeholders.json) | The values the self-test and the template verification fill in (`lights-out`) | When adding a placeholder |
| [assets/shared.json](assets/shared.json) | Declares the synced files (check-lib, app-modules, the game kit and rules copies, `star-rating.ts`, the canonical RNG, date keys and Prettier config for the fixtures) | When adding a shared file |
| `scripts/check-levels.mjs` | Checker: kit, prerequisites, generator, fast-check pin, the star rule (run), the levels contract, packs, curves, modes, salts, pack names, goldens, contract test, import zone, determinism, placeholders, regeneration by value and by byte | Steps 2 and 10, and at the end |
| `scripts/lib/` | `level-layout.mjs` (paths, options, contract), `level-checks.mjs`, `level-run.mjs`, `pack-format.mjs` (Prettier's JSON layout when Prettier is absent), `ts-scan.mjs`; `app-modules.mjs` is synced (do not edit here) | When changing the checker |
| `scripts/selftest.mjs` | Proves the checker: the templates must pass, the score-rated variant must pass, every planted bug must fail under its rule | After changing the checker or a template |
| `scripts/check-lib.mjs` | Shared script library, synced (do not edit here) | Never by hand |
| `tests/bases/app/` | The minimal app the fixtures lay the templates on (package.json, tsconfig, synced core files and Prettier config; the catalogs come from the templates) | When the fixture base changes |
| `tests/fixtures/` | `check-levels/` (`good/`, one `bad-*` per rule, `pass-*` and `error-*` cases) and `check-levels-score/` (`score.json`, `good/`, two pack cases) | When adding a rule to the checker |

## Related skills

- `game-rules-engine` - `create`, `listMoves`, `applyMove`, `outcome`, the game kit and the difficulty scale the levels are built on.
- `seeded-determinism-and-golden-vectors` - `sfc32`, `dailySeed`, date keys and the determinism policy.
- `game-balance-and-bots` - the tuning and bot sims that pass before the packs are generated.
- `game-session-host` - starting level, daily and endless runs, stars at run end and "Next level".
- `dates-streaks-and-statistics` - today from the clock, streaks and the daily calendar.
- `golden-and-snapshot-tests` - the golden project, `[contract]` entries and `contracts/goldens.json`.
- `run-goldens-rebaseline` - re-blessing goldens on purpose.
- `screen-contracts` - the levels and result screens that show packs and stars.
- `i18n-strings-and-catalogs` - the catalogs that hold pack names.
- `new-game-scaffold` - declaring a game (`contracts/games.json`) before its rules and levels, and its completeness gate.
- `performance-budgets` - measuring a hint's solver budget on a low-end Android phone.
- `git-commits-and-reporting` - the `Gate-Change:` trailer for tables and goldens.
