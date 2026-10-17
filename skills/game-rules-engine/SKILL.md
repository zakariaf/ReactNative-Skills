---
name: game-rules-engine
description: "Builds game rules as a pure seeded engine: create, listMoves, applyMove, outcome, events, property tests. Use when writing game rules, moves, scoring or in-game randomness. Not for levels (level-generation-and-solvers)."
---

# Game rules engine

Makes every game's rules a pure, deterministic TypeScript engine behind one game contract: the same
seed and moves give the same states on iOS, Android, Jest and Node, so bots, solvers, saves, undo,
replays and the daily level can all trust it. The skill ships the kit (`src/core/game/`: the contract
types, the difficulty scale and the test helpers), a complete template game (the public-domain puzzle
Lights Out) and a checker that proves the kit, the seeded RNG against its golden values and each
game's rules, by running them.

## Rules that must hold

1. **The engine functions are pure and live in `src/games/<game-id>/rules/`, one per file:**
   `create.ts`, `list-moves.ts`, `apply-move.ts`, `outcome.ts`, importing only `src/core` and the
   game's own `rules/`, `levels/` and `geom/`. Why: bots, solvers, goldens and save replays call them
   headless thousands of times; one React Native, store or app import breaks all of that.
2. **Rules follow the determinism policy:** only `+ - * /`, `%`, bitwise operators and
   `Math.sqrt/imul/floor/round/abs/min/max/PI`; no `**`, no other `Math.*`, no `Math.random`, `Date`,
   `performance.now`, `Intl`, `toLocale*` or `localeCompare` (tests: no clock, no randomness either).
   Why: Hermes uses each platform's libm and locale data while Jest uses V8's, so replays and daily
   levels would diverge between an iPhone, an Android phone and CI (seeded-determinism-and-golden-vectors
   owns the policy).
3. **All randomness comes from `src/core/rng/sfc32.ts`, threaded as state.** A game that draws after
   `create()` keeps `rng: RngState` in its state and every draw advances it; never re-seed from the move
   count. Why: same seed, same level, same daily and same replay on every device, and a continue or an
   undo cannot re-roll.
4. **`sfc32.ts` and its golden values never change:** `seedRng(1)` draws `1828152527, 3394835397,
   2967886022, 2251045104, 4148684523` and `hashSeed('tasks:2026-09-26')` is `2847463752`. Why: they are
   the compatibility contract of every generated level, daily and saved run; a different generator is
   a new module under a new name, and a question for the developer.
5. **Copy the kit verbatim** from `templates/src/core/game/` and never rename a member (`create`,
   `listMoves`, `applyMove`, `outcome`, `panMode`, `selectRegions`, `intentToMove`, `hud`, `undo`,
   `hints`, `continueRun`; `identity` is `{ id, nameId }`). Why: the session host, the bots, the solver,
   the canvas skills and the checker all call these exact names and shapes.
6. **The input is declared as data next to its intent function:** `panMode` (`'none'` taps only,
   `'swipe'`, `'drag'`, `'aim'`) and `selectRegions` are literals in the module, and `intentToMove` (in
   `src/games/<game-id>/canvas/`) returns only moves `listMoves` lists and only for the intents that
   pan mode sends. Why: the screen enables exactly that gesture; a game expecting swipes on a `'none'`
   surface is unplayable, and legality decided anywhere but `listMoves` lets bots and players disagree.
7. **Difficulty is one scale, whole numbers 0..100** (`difficulty.ts`): `create` clamps to it, tuning
   rows come from `rowFor`, levels and the daily use 0..99, and 100 (`ENDLESS_DIFFICULTY`) is the
   endless run of a game with an endless mode, which is never won. Why: the curve, the tuning, the daily
   and the saved runs must mean the same numbers, and there is no mode argument to tell an endless run apart.
8. **A selection is UI state, never a move.** Tap-then-tap games list their selecting regions in
   `selectRegions` (`[]` for most); `intentToMove` returns `null` for a tap there and reads
   `intent.selected` on the next tap. Why: a `select` move would be seen by bots, the solver, par, undo
   and the counters.
9. **State, moves and events are JSON-safe:** plain objects, arrays, finite numbers, strings, booleans,
   `null`; no `Map`, `Set`, `Date`, classes, `undefined` or typed arrays. Why: runs are saved as JSON
   after every move and replayed; anything JSON drops corrupts a save.
10. **`applyMove` never changes its input and throws `RangeError` for an illegal move.** Why: the undo
    history keeps old states by reference, and a loud failure beats a silently corrupted save.
11. **`listMoves` is empty exactly when `outcome` is not `playing`, in a fixed order; each way of losing
    has its own `<game-id>.lose.<reason>` key in every catalog of the app; win scores are whole numbers
    >= 0.** Why: bots, solvers and the host's end-of-run logic rely on it, and every visible sentence is
    a translated message.
12. **Events are past tense, kebab-case, and carry every id and from/to value** the animation and the
    counters need. Why: the surface only receives the final state; the events alone explain how it got there.
13. **Every rules folder has example tests, fast-check properties (determinism, invariants, end state,
    JSON round trip) and one pinned `GOLDEN_*` value, at 95/95/95/90 coverage.** Why: the tests are the
    specification, and properties alone let real bugs survive.
14. **A saved run parses back to exactly itself.** `parseState` / `parseMove` rebuild a fresh typed
    value with explicit checks (never `json as State`) and return `null` otherwise; `stateVersion` and
    `migrateState` handle older shapes. Why: a damaged or old save must drop only the run, not crash the
    app later.
15. **The testing spec plays fair:** the bot picks only offered moves and returns its own seeded stream,
    and the `start`, `middle`, `win`, `lose` examples have exactly the outcome their names promise. Why:
    balance runs, hints, screenshots and E2E setup are built on them.
16. **Once the canvas exists, the game is one typed `GameModule`** in `src/games/<game-id>/<game-id>-game.ts`
    whose `identity.id` is the folder name, with a test that runs the contract with its input. Why: the
    host binds games only through this value, and the id names the folder, the catalog namespace and
    every saved run.

## Workflow

1. **Classify and plan.** Read [references/engine-contract.md](references/engine-contract.md). Classify
   the game (turn-based, simulate-then-replay, real-time) and write down in plain words: moves, win, each
   way of losing, score, undo, hints, continue, an endless mode (difficulty 100), the input (`panMode`,
   tap-then-tap `selectRegions`). If the design does not say, ask the developer (defaults: unlimited
   undo, or none when the game draws during play; no hints; no continue; no endless mode; taps only).
2. **Install the kit once per app.** Pin fast-check exactly in the root `devDependencies` (the kit's,
   the RNG's and the rules' tests import it; without it `tsc` fails with TS2307 on every copied test):
   `npm install -D -E fast-check@4.10.2` (verified on 2026-10-03; re-verify: `npm view fast-check
   version`). Run
   `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs .`; for each `kit-file-missing` copy the
   file from `templates/src/core/` to `src/core/` verbatim (with its test). `src/core/rng/sfc32.ts` is
   canonical: if seeded-determinism-and-golden-vectors already put it there, keep that copy. A
   `kit-member-missing` line names an older copy: replace it and fix what `tsc` reports. Read
   [references/determinism-and-rng.md](references/determinism-and-rng.md) before anything random.
3. **Copy the rules templates.** `templates/src/games/__GAME_ID__/` to `src/games/<game-id>/`, renaming
   files and replacing `__GAME_ID__` (kebab case), `__GAME_PASCAL__` and `__GAME_CONST__` (UPPER_SNAKE).
   The template is a complete small game (Lights Out with a move budget); keep its structure and replace
   its logic test by test. Every balance number lives in `<game-id>-tuning.ts`.
4. **Add the catalog keys** the templates name to every catalog of the app (`src/i18n/catalogs/<locale>.json`,
   i18n-strings-and-catalogs): [assets/template-catalog-keys.json](assets/template-catalog-keys.json)
   holds each key with an English and an RTL text (`.name`, `.hud.moves`, `.continue.more-moves`,
   `.lose.out-of-moves`, `.stats.*`). A renamed or new key (a lose reason, a hud line, a counter) goes
   into every catalog too, and translations go through the app's review queue.
5. **Write the rules test-first, in this order,** following [references/writing-rules.md](references/writing-rules.md)
   and [references/testing-rules.md](references/testing-rules.md): types, tuning and `create` (with its
   pinned golden), `outcome` and `listMoves`, `applyMove`, the rules members, persistence, counters, then
   the bot and example states. For each behaviour: one failing test, read the failure (an assertion, not
   an import error), minimum code, green. Imitate `examples/pig/` for a game that draws during play, has
   an endless run or more than one way of losing.
6. **Assemble the engine** (`rules/<game-id>-engine.ts`: `<CONST>_ENGINE` and `<CONST>_RULES`) and keep
   its contract test (`<game-id>-engine.test.ts`; add `endless` for a game with an endless mode).
7. **Assemble the module once the canvas exists.** When canvas-gestures-and-hit-testing has written
   `src/games/<game-id>/canvas/intent-to-move.ts`, write `<game-id>-game.ts` and `<game-id>-game.test.ts`
   from `examples/lights-out-module/`, with `panMode` and `selectRegions` from step 1 and the intents the
   surface really sends. Until then the checker prints one SKIP for the module.
8. **Format, lint and type-check:** `npx eslint --fix src/games/<game-id> src/core/game`,
   `npx prettier --write src/games/<game-id>` (import order depends on the game id), `npm run typecheck`.
9. **Run the tests with coverage:** `npx jest src/games/<game-id> --ci --selectProjects unit --coverage
   --collectCoverageFrom='src/games/<game-id>/rules/**/*.ts' --coverageThreshold='{}'` (paths first;
   `--coverageThreshold='{}'` because a subset run cannot meet the global numbers) and read the table:
   rules stay at 95/95/95/90. When a module is finished, run Stryker on it (break threshold 75 %).
10. **Run the check** `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs . --game <game-id>`; fix
    every `FAIL` line (file, rule, fix) and rerun until `RESULT: PASS`. An `engine-contract` line names
    the seed and difficulty: add that case as an example test first, then fix the engine. Rules,
    options and troubleshooting: [references/checker.md](references/checker.md).

## Definition of done

- [ ] The root `package.json` pins `fast-check` exactly in `devDependencies` (no `kit-test-dependency`).
- [ ] `src/core/game/` holds the kit (ten contract files, `difficulty.test.ts`, the five testing
      helpers with their tests) and `src/core/rng/sfc32.ts` with its golden test, all passing.
- [ ] `src/games/<game-id>/rules/` has the types, tuning, `create`, `list-moves`, `apply-move`,
      `outcome`, engine, persistence and stats files, each with tests; `testing/<game-id>-testing.ts`
      has a bot and the four example states.
- [ ] Every rules test file follows the loop: examples, fast-check properties, one `GOLDEN_*` value;
      the rules folder is at 95/95/95/90.
- [ ] Every catalog key the rules and the module name (hud, stats, continue, each `.lose.<reason>`,
      `.name`) is in every catalog of the app.
- [ ] Once the canvas exists, `<game-id>-game.ts` sets `panMode` and `selectRegions`, and its test runs
      `engineContractProblems` with the input (and `endless` when the game has an endless mode) and
      returns `[]`.
- [ ] `npm run typecheck`, `npx eslint --max-warnings 0` and `npx prettier --check` pass for
      `src/core/game` and `src/games/<game-id>`; no `__GAME_` placeholder is left.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs . --game <game-id>` prints `RESULT: PASS`

A passing run may print `SKIP src/games/<game-id>/canvas/intent-to-move.ts [module-missing] not yet created (canvas-gestures-and-hit-testing creates it)`
before the canvas surface exists, and `SKIP src/i18n/catalogs [catalog-key-missing] not yet created (i18n-strings-and-catalogs creates it)`
before the app has catalogs. An app with no game prints `NOT APPLICABLE: the app has no game (...)`.

## Anti-patterns

- **`Math.random()` "just for a quick shuffle", or a seed from the clock.** Replays and daily levels
  break silently; draw from `state.rng` (or `drawOne`/`shuffle` from `src/core/rng/seeded-draws.ts`).
- **Re-seeding inside `applyMove` from the move count** to avoid storing the stream. Two runs that reach
  the same position by different paths then draw different futures, and a continue re-rolls.
- **Mutating the state in place for speed** (`state.cells[i] = 1`). The undo stack and the saved
  snapshot share references; build new arrays with `map` and spreads.
- **Returning the old state for an illegal move.** The bug hides until a save is corrupted; throw.
- **Legality in the gesture code, the screen or the store.** Bots and solvers would disagree with
  players; only `listMoves` decides, and `intentToMove` asks it.
- **Choosing the pan mode in the screen.** It belongs to the module next to `intentToMove`, where the
  contract test proves the two agree.
- **A `select` move for tap-then-tap.** It pollutes bots, par, undo and the counters; list the region in
  `selectRegions` and read `intent.selected`.
- **A `mode` argument, or a tuning table indexed 0..3.** Difficulty is one 0..100 scale; pick rows with
  `rowFor` and mark the endless run with difficulty 100.
- **Casting `json as State` in `parseState`.** A damaged or old save then crashes later; rebuild the
  typed value with explicit checks and return `null` otherwise.
- **Sentences in rules** (`reasonKey: 'Out of moves!'`). Return `<game-id>.lose.<reason>` keys; the
  app's i18n layer formats them in the user's language, left to right or right to left.
- **Editing a golden to make a test pass.** A changed golden means shipped levels changed: change it
  only on purpose, with a `Gate-Change:` trailer, and never the RNG goldens.
- **`Math.atan2` for a direction or `**` for a square.** Use dot products, committed direction tables
  and `x * x`.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/engine-contract.md](references/engine-contract.md) | The contract member by member, where code lives, difficulty and endless, input and selection, rules, persistence, stats, testing, the module, contract tests, game classes, multi-package | Workflow step 1 |
| [references/determinism-and-rng.md](references/determinism-and-rng.md) | The determinism policy applied to rules and why, the RNG API and goldens, randomness in `create` and during play, sims, particles, bots, the daily level | Step 2, and before anything random |
| [references/writing-rules.md](references/writing-rules.md) | Types, tuning and create, outcome and listMoves, applyMove, rules members, persistence, counters, bot, engine and module assembly, size limits | Steps 3, 5, 6 and 7 |
| [references/testing-rules.md](references/testing-rules.md) | The loop, names, examples, the property checklist, pinned goldens, both contract tests, gates, commands, traps | Steps 5 and 9 |
| [references/checker.md](references/checker.md) | The checker's options, config keys, every rule, expected SKIP and NOT APPLICABLE lines, multi-package, troubleshooting | Step 10, when a line is unclear |
| `templates/src/core/game/` | The kit: ten contract files (copy verbatim) and `difficulty.test.ts`. This skill owns them; their canonical copy is synced into level-generation-and-solvers, game-session-host and game-balance-and-bots, so a change here reaches all four | Step 2 |
| `templates/src/core/game/testing/` | `play-choices`, `play-bot`, `json-shape`, `engine-contract`, `contract-intents`, each with its test | Step 2 |
| `templates/src/core/rng/` | `sfc32.ts` and its golden test (synced; seeded-determinism-and-golden-vectors owns them) | Step 2 |
| `templates/src/games/__GAME_ID__/rules/` | The template game (Lights Out): types, tuning, create, toggle-cells, list-moves, apply-move, outcome, engine, persistence, stats, and their tests | Step 3 |
| `templates/src/games/__GAME_ID__/testing/` | Greedy bot and example states, with a test | Step 3 |
| `examples/lights-out-module/` | The module assembly with its contract test and the shape of the canvas intent function (canvas-gestures-and-hit-testing owns that file) | Step 7 |
| `examples/pig/` | Pig, a dice game that draws during play: the stream in the state, two ways of losing, an endless row, a continue, persistence of the stream, the hold-at-20 policy in `rules/` (level-generation-and-solvers' witness uses the same file) re-exported as the bot, tests that read every knob from `TUNING`, and `catalog-keys.json` | Step 5, for games that draw during play |
| `assets/template-catalog-keys.json` | Every catalog key the templates name, with an English and an RTL (Arabic) text | Step 4 |
| `assets/template-placeholders.json` | The values the self-test and the template verification fill in (`lights-out`) | When adding a placeholder |
| `assets/shared.json` | Declares the synced files (check-lib, app-modules, the canonical RNG, and this skill's own kit, template rules and Pig hold policy, whose canonical copies other games skills sync) | When adding a shared file |
| `scripts/check-rules-engine.mjs` | Checker: kit files and members, the fast-check pin, RNG goldens (run for real), purity, determinism, JSON state, events, throws, reason and catalog keys, tests, engine and module assembly, a seeded run with random play and the bot, endless never won | Steps 2 and 10, and at the end |
| `scripts/lib/` | `game-layout.mjs` (folders and options), `kit-checks.mjs`, `rules-checks.mjs`, `engine-run.mjs`, `ts-scan.mjs`; `app-modules.mjs` is synced (do not edit here) | When changing the checker |
| `scripts/selftest.mjs` | Proves the checker: the templates and the module example must pass, the Pig example must pass, every planted bug must fail under its rule | After changing the checker, a template or an example |
| `scripts/check-lib.mjs` | Shared script library, synced (do not edit here) | Never by hand |
| `tests/bases/app/` | The minimal app (package.json, tsconfig, catalogs) the fixtures lay the templates on | When the fixture base changes |
| `tests/fixtures/` | `check-rules-engine/`: `good/`, one `bad-*` per rule, `pass-*` (before the canvas, before the catalogs, no game, kit only, the Pig example, installed skills, a custom games folder) and `error-*` cases | When adding a rule to the checker |

## Related skills

- `seeded-determinism-and-golden-vectors` - the determinism policy, `sfc32`, seeds, salts and golden vectors.
- `level-generation-and-solvers` - generators, solvers, par, packs, stars and the daily level built on `create`.
- `game-session-host` - hosting the module: the game screen, undo, hints, continue, saves and results.
- `canvas-gestures-and-hit-testing` - `intentToMove`, the intents and the selection in the screen.
- `skia-canvas-rendering` - the surface that draws the state and plays the events.
- `realtime-game-loop` - real-time sims and simulate-then-replay physics.
- `game-balance-and-bots` - bot policies, simulations and the tuning file.
- `new-game-scaffold` - declaring the game and its catalog keys before the rules.
- `unit-and-component-tests` - Jest projects, fast-check, coverage and mutation thresholds.
- `tdd-workflow` - the red-green loop and evidence for every change.
