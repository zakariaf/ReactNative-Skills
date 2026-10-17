---
name: game-balance-and-bots
description: "Tunes game difficulty with seeded headless bots: sim reports, balance bands, tuning knobs, a fun-in-seconds test. Use when balancing, tuning pacing or adding bots or sims. Not for solvers or par (level-generation-and-solvers)."
---

# Game balance and bots

Every game is played thousands of times headless by seeded bots before a person plays it. The sims
measure the difficulty curve, whether skill matters, how soon the first win moment comes and whether
the twist happens; a bands file says what "balanced" means; every balance number lives in one tuning
file. This skill builds the harness once (`src/core/game-balance/`, `test/sims/write-sim-report.ts`),
each game's bots, sims and bands, and the check that judges the numbers.

## Rules that must hold

1. **Bots play only through the pure engine contract** (`create`, `listMoves`, `applyMove`,
   `outcome`), headless in plain Node via `jest.sim.config.js`, never through the UI. Why: the same
   rules the app runs are measured, in seconds, with no React Native mock.
2. **Every run is deterministic:** seeds `1…seedsPerCell`, the bot's own seeded RNG, no
   `Math.random`, `Date`, `performance.now`, retries, skips or focus; the report has no timestamps.
   Why: a rerun gives identical bytes, so a diff of the report shows exactly what a change did, and
   chosen seeds could shop for numbers.
3. **Every run has a hard move cap, and no run may reach it** (`capHits` = 0). Why: a stuck or
   endless game is a rules bug that a bot finds long before a player does.
4. **Use the three standard players:** `random` (the baseline), a reasonable player (the testing
   spec's `bot`: `greedyPolicy` by default) and `lookahead` (the upper bound; it sees the seeded
   future). In a game that draws during play (dice, cards, spawns), the reasonable player is a rule a
   person could follow and never peeks at the next draw: `greedyPolicy` would. Skill must matter:
   random < reasonable < lookahead by a clear step. Why: if naive play does as well as sensible play,
   the choices are fake; a peeking player measures nothing a person meets.
5. **A sim asserts properties of at least 100 seeds per cell, never a single outcome,** and writes
   `reports/sim/<game-id>.json` before its assertions. Why: one game proves nothing about balance, and
   a failing run must still leave numbers to read.
6. **Every balance number lives in `src/games/<game-id>/rules/<game-id>-tuning.ts`** (real-time games:
   `sim/<game-id>-tuning.ts`, a `'worklet'` module): documented knobs plus a per-difficulty table read
   through `knobsFor`; the rules contain no other balance numbers. Why: one place to tune, and a diff
   shows every balance change.
7. **Difficulty is one scale, whole numbers 0..100, never a table index.** `knobsFor(d)` returns the
   endless row at 100 (`ENDLESS_DIFFICULTY`, no goal, never won) and otherwise the row
   `rowFor(d, rows)` picks, with a `reduce` over the table; the grid samples the lower bound of each
   row (`[0, 25, 50, 75]` for four rows), and an endless mode gets its own `endless` block at 100,
   never a step of the curve. Why: levels (0..99), a daily and saved runs all use this scale; a 0..3
   index makes every level above 3 play the hardest row.
8. **Balance is a contract in `test/sims/<game-id>/balance-bands.json`:** the bands hold, the curve
   moves monotonically by `minStep`, the skill gap holds, the first payoff comes early, the twist
   happens, and the endless run is never won and stays inside its own bands. Never widen a band, cut
   or change seeds, or tune the bot to go green. Why: bands are the design record; moving them hides
   the problem instead of fixing the game.
9. **The fun-within-seconds kill test:** on the easiest level the reasonable player reaches the first
   payoff within 1-3 moves (2 for single-tap moves; seconds for real-time games: `runSimBot` with
   `payoffStepTicks: 120`) in at least 90 % of runs, and the twist fires at least once per run. If
   even the lookahead bot cannot, stop and report to the developer. Why: prototype bots showed ideas
   fail here structurally (a loop-closing snake caught nothing in 13 foreseen moves; a crash puzzle's
   twist came 0.25 times per game).
10. **A report counts only for the code it measured:** its fingerprint covers the game's `rules/`,
    `levels/` (without the generated `pack-*.json`), `sim/`, `geom/` and `testing/` folders, the sim
    file and the `src/core` files they import (the sim's import closure), and game logic imports
    nothing outside them; rerun `npm run test:sim` after any change there. Why: stale numbers approve
    code that no longer exists.
11. **Change the game, not the player:** improve a bot's evaluation only to match reasonable human
    play, never to reach a band; decide the payoff and twist tags before the first run. Why: a bot or
    a tag tuned to the bands measures nothing.
12. **A person's play-test is the final judge, and it never blocks:** bands stay `"proposed"` until a
    person has played on an iPhone and an Android phone and agreed, then become `"approved"` with a
    date. Until then every report lists it under "Human checks (not blocking)", and
    `check-balance.mjs --release` prints a `HUMAN CHECK (not blocking)` line, not a problem. Why: bots
    measure pace, not joy; the person's feel wins whenever it comes, and nothing waits for it.
13. **Bot numbers hold on both platforms only through pure, seeded rules and fixed ticks.** Sims run in
    Node (V8), the app on Hermes on iOS and Android; a real-time sim counts fixed ticks, never display
    frames (60 Hz Android phones, 120 Hz iPhones). Why: a balance claim that depends on the engine,
    the frame rate or the device is not a claim about the game.

## Workflow

1. **Pick the job.** First harness setup: step 2. A game's bots and sims: steps 3-8. Retuning: steps
   6-8. Judging a new idea early: read [references/fun-and-kill-test.md](references/fun-and-kill-test.md),
   then steps 3-5 at the easiest difficulty only. Always finish with steps 9-10.
2. **Harness (once per app).** Read [references/bots-and-sims.md](references/bots-and-sims.md). The
   game kit (`src/core/game/`, `src/core/rng/sfc32.ts`) comes from game-rules-engine. Run
   `node ${CLAUDE_SKILL_DIR}/scripts/check-balance.mjs .`; for every `harness-missing`,
   `harness-outdated` or `sim-config` line copy the file from `templates/` verbatim
   (`src/core/game-balance/*` with tests, `test/sims/write-sim-report.ts` with its test,
   `jest.sim.config.js`), keep `"test:sim": "jest --ci --config jest.sim.config.js"` in
   `package.json`, and make the unit project of `jest.config.js` ignore `\\.sim\\.test\\.` (both are
   in the canonical configs). Run `npx jest src/core/game-balance test/sims/write-sim-report.test.ts --ci --selectProjects unit`
   (paths first: `--selectProjects` swallows every following word).
3. **Tuning file.** Read [references/tuning-playbook.md](references/tuning-playbook.md) first. The
   game already has `rules/<game-id>-tuning.ts` from game-rules-engine's template. Name the knobs for
   the game (document each per-difficulty knob once, on the knobs type), move every balance number of
   the rules into it and read them through `TUNING` and `knobsFor(difficulty)`, keeping the `rowFor` +
   `reduce` lookup. A game with an endless mode adds the endless row and returns it first for
   `isEndlessDifficulty(difficulty)`: [examples/pig/src/games/pig/rules/pig-tuning.ts](examples/pig/src/games/pig/rules/pig-tuning.ts).
4. **Bot hooks, test-first.** Copy `templates/src/games/__GAME_ID__/testing/__GAME_ID__-bot.ts` and
   its test (Lights Out's hooks; replace `__GAME_ID__`, `__GAME_PASCAL__` and `__GAME_CAMEL__`) and
   rewrite them for the game: `evaluate<Game>`, `scoreOf<Game>` (the number the HUD shows),
   `tag<Game>Event` (payoff and twist, decided now) and the reasonable player; then set it as `bot` in
   `testing/<game-id>-testing.ts`. A game that draws during play writes the reasonable player as a rule
   ([examples/pig/src/games/pig/testing/pig-bot.ts](examples/pig/src/games/pig/testing/pig-bot.ts)).
   When the levels are proven by the reasonable player (a witness), put the evaluation in
   `rules/<game-id>-evaluate.ts` and re-export it: `levels/` may not import `testing/`. A real-time
   game exports its `SimBotGame` hooks and the `idle`, `wander` and `dodge` command policies
   ([examples/arena-chase/src/games/arena-chase/testing/arena-chase-bot.ts](examples/arena-chase/src/games/arena-chase/testing/arena-chase-bot.ts)).
5. **Sim and bands.** Copy `templates/test/sims/__GAME_ID__/` to `test/sims/<game-id>/`, replace the
   placeholders, set the grid to the lower bound of each tuning row (the template's `[0, 34, 67]` are
   Lights Out's three), name the policies, and for an endless mode replace `"endless": null` with its
   block ([references/balance-contract.md](references/balance-contract.md), "Endless mode"). Run
   `npx eslint --fix` and `npx prettier --write` on it, then
   `npx jest test/sims/<game-id> --ci --config jest.sim.config.js`. The first run writes the report
   even if the bands fail. Real-time games play through `runSimBot` instead of `traceBot`
   ([examples/arena-chase/test/sims/arena-chase/balance.sim.test.ts](examples/arena-chase/test/sims/arena-chase/balance.sim.test.ts)).
6. **Read and tune.** Fix what is broken first (cap hits, replay differences, no early payoff, no
   twist), then tune one knob at a time with the tuning loop and the symptom table, rerunning the sim
   after each change and reading `lossReasons`.
7. **Write the bands** around the tuned numbers with a margin and a `why` per band, and the story in
   `notes` in plain words; keep `"status": "proposed"`.
8. **Kill test verdict.** If the first payoff or the twist cannot be reached after reasonable tuning,
   stop and tell the developer (fun-and-kill-test.md, "When a game fails"). Do not polish a game that
   fails it.
9. **Run the check** (run, fix, rerun until `RESULT: PASS`): `npm run test:sim`, then
   `node ${CLAUDE_SKILL_DIR}/scripts/check-balance.mjs .` (add `--game <game-id>` for one game).
   Options, config keys and troubleshooting: [references/checker.md](references/checker.md).
10. **Report and hand over.** Put the plain-language "Bots" line per difficulty (numbers from the
    report) in the evidence report and "Play-test <game> on an iPhone and an Android phone" under
    "Human checks (not blocking)" until a person has done it; when they agree, set
    `"status": "approved"` and `"approvedOn"`. Before a release run the check with `--release`: it
    passes with proposed bands and prints the `HUMAN CHECK (not blocking)` line to copy into the
    release report. The sims pass before level-generation-and-solvers generates the level tables; a
    tuning change after they exist regenerates them in the same commit with a `Gate-Change:` trailer.

## Definition of done

- [ ] The harness files and their unit tests are in place and green; `npm run test:sim` exists and
      never runs inside `npm test`.
- [ ] Each game has a documented tuning file on the 0..100 scale (`rowFor` + `reduce`, an endless row
      only with an endless mode) with its test, bot hooks with tests (a non-peeking reasonable player
      when the game draws during play), `test/sims/<game-id>/balance.sim.test.ts` and
      `balance-bands.json` with `notes` (grid 0..99, the endless block when the game has one).
- [ ] `npm run test:sim` passes: no cap hits, identical replays, every band, the curve, the skill gap,
      the first payoff and the twist; one sim file runs in about 60 s or less.
- [ ] `reports/sim/<game-id>.json` is fresh and its numbers are in the evidence report in plain words.
- [ ] For a release: the check passes with `--release`; each `HUMAN CHECK (not blocking)` line is in
      the report's "Human checks (not blocking)" list.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-balance.mjs .` prints `RESULT: PASS`

A passing run may print `SKIP src/core/game/testing/play-bot.ts [harness-missing] not yet created (game-rules-engine creates it)`
before the kit is installed. An app with no game prints
`NOT APPLICABLE: the app has no game (no src/games/<game-id>/ folder with rules/ or sim/)`.

## Anti-patterns

- **Balancing by playing a few games by hand, or by one seed.** Balance is a distribution; run 100+
  seeds per cell and read the spread (`p10Moves`, `p90Moves`, `lossReasons`).
- **Loosening a band, lowering `minStep` or trimming seeds to get green.** Change a knob, or bring the
  developer a design question.
- **A smarter bot to rescue a failing curve, or a greedy bot that peeks at the next roll.** If random ≈
  reasonable, the game's choices are weak; fix the rules. A peeking bot never loses a turn's points and proves nothing.
- **Renaming the payoff after a failing run.** Decide the tags first and write why in `notes`.
- **Balance numbers scattered through the rules** (`hearts: 3` in `create.ts`). Move them into the
  tuning file with a comment.
- **A sim that needs React Native, a clock or `Math.random`.** The rules must be pure and seeded.
- **Trusting a report after changing the rules.** The fingerprint makes it stale; rerun the sims.
- **Tuning the whole difficulty table at once.** Change one knob, rerun, compare the two reports.
- **Difficulty as a table index, or 100 in the grid.** Use `rowFor` and the `endless` block.
- **`table[index] ?? table[0]`.** The fallback never runs and fails the per-file branch threshold.
- **Polishing a game that fails the kill test.** Art and sound cannot fix a first payoff that never
  comes; stop and ask the developer.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/bots-and-sims.md](references/bots-and-sims.md) | The harness, what a bot needs, the three players, non-peeking players, bot hooks, tags, the sim file, real-time games, determinism on iOS and Android, speed, debugging, reporting, multi-package | Workflow steps 2, 4 and 5 |
| [references/balance-contract.md](references/balance-contract.md) | The report fields, the fingerprint, the bands file, endless mode, setting bands, approval as a human check, how the check judges | Steps 6, 7 and 10 |
| [references/tuning-playbook.md](references/tuning-playbook.md) | The tuning file, knob families, the curve, the tuning loop, symptoms and what to turn, the Pig tuning log, levels and daily | Steps 3 and 6 |
| [references/fun-and-kill-test.md](references/fun-and-kill-test.md) | Why seconds matter, the kill test, what prototype bots revealed, openings built for an early payoff, choosing payoff and twist, when to stop | Steps 1 and 8 |
| [references/checker.md](references/checker.md) | The checker's folders, options, config keys, every rule, expected SKIP/NOT APPLICABLE/HUMAN CHECK lines, troubleshooting | Step 9, when a line is unclear |
| `templates/src/core/game-balance/` | `trace-bot`, `bot-policies`, `sim-stats`, `balance-bands`, `parse-balance-bands`, `run-sim-bot`, each with its test | Step 2 (copy verbatim) |
| [templates/test/sims/write-sim-report.ts](templates/test/sims/write-sim-report.ts) | `SIM_LAYOUT`, `rulesFingerprint` over the sim's import closure (`fingerprintFiles`) and `writeSimReport` | Step 2 |
| [templates/test/sims/write-sim-report.test.ts](templates/test/sims/write-sim-report.test.ts) | Its test: unrelated core or screen files and generated level tables leave the fingerprint unchanged; an imported core file (even through another), a rules file or the level plan changes it | Step 2 |
| [templates/jest.sim.config.js](templates/jest.sim.config.js) | Plain-Node Jest config for `*.sim.test.ts` (synced canonical file; do not edit here) | Step 2 |
| [templates/test/sims/__GAME_ID__/balance.sim.test.ts](templates/test/sims/__GAME_ID__/balance.sim.test.ts) | A game's sim: plays the grid, writes the report, asserts the bands | Step 5 |
| [templates/test/sims/__GAME_ID__/balance-bands.json](templates/test/sims/__GAME_ID__/balance-bands.json) | The template game's balance contract (Lights Out's measured bands on three rows, `endless: null`) | Steps 5 and 7 |
| [templates/src/games/__GAME_ID__/testing/__GAME_ID__-bot.ts](templates/src/games/__GAME_ID__/testing/__GAME_ID__-bot.ts) | Lights Out's bot hooks: `evaluate` (fewer lit cells, a board one press from dark valued as a person sees it), `scoreOf`, `tag`, the greedy reasonable player | Step 4 |
| [templates/src/games/__GAME_ID__/testing/__GAME_ID__-bot.test.ts](templates/src/games/__GAME_ID__/testing/__GAME_ID__-bot.test.ts) | Its test | Step 4 |
| `templates/src/core/game/` | Synced copies (assets/shared.json) of game-rules-engine's `game-engine.ts`, `difficulty.ts` and `testing/play-bot.ts` (with tests), so the templates compile alone; never edit here, keep that skill's files | Never copy over that skill's kit |
| `templates/src/games/__GAME_ID__/rules/` | Synced copies of game-rules-engine's template game (Lights Out: types, tuning with its test, create, toggle-cells, list-moves, outcome, apply-move) that the bot template and the self-test need; never edit here | Step 3, as the tuning model |
| `examples/pig/` | Pig, the turn-based model: the tuned tuning file with an endless row, a non-peeking reasonable player and its test, the sim, bands with an endless block and the real report (the game's rules are game-rules-engine's Pig example) | Steps 3-7 for a game that draws during play or has an endless mode |
| `examples/arena-chase/` | The real-time model: a fixed-step sim and `'worklet'` tuning file (+ replay tests), `SimBotGame` hooks and the idle/wander/dodge command policies (+ tests), a `runSimBot` sim, bands in ticks and seconds, and its real report | Steps 3-7 for a real-time game |
| `scripts/check-balance.mjs` | Checks the sim config, harness, sims, seeds, bot hooks, tuning file, fingerprint scope and bands, and judges each report; `--release` prints unapproved bands as a HUMAN CHECK line | Steps 2, 9 and 10 |
| `scripts/lib/balance.mjs` | Folders and options, the JavaScript port of the fingerprint and the bands rules | When changing the checker |
| `scripts/selftest.mjs` | Proves the checker passes the templates and both examples and catches every planted bug | After changing the checker, a template or an example |
| `scripts/check-lib.mjs` | Shared script library, synced (do not edit here) | Never by hand |
| `assets/shared.json` | Declares the synced files (check-lib, the sim Jest config, game-rules-engine's kit and template rules copies) | When adding a shared file |
| `assets/template-placeholders.json` | The values the self-test and template verification fill in (`lights-out`) | When adding a placeholder |
| `tests/build-fixtures.mjs` | Writes the overlay cases (ops, EXPECT lines with computed file:line, re-stamped fingerprints) | After changing a template, an example or the checker |
| `tests/bases/app/` | The minimal app the fixtures lay the templates and examples on, with Lights Out's real report | When the fixture base changes |
| `tests/fixtures/` | `check-balance/`: `good/`, one `bad-*` per rule and planted bug, `pass-*` (before the kit, wrapped table, release with proposed bands, core growth, packs after sims, installed skills, no game, custom games folder, one game) and `error-*` cases | When adding a rule |

## Related skills

- `game-rules-engine` - the engine contract, the kit, the determinism policy and the sfc32 PRNG the bots drive.
- `level-generation-and-solvers` - solvers, par, stars, level tables and the witness that plays them.
- `realtime-game-loop` - the fixed-step sims that `runSimBot` plays headless.
- `new-game-scaffold` - where a new game's tuning file, bot hooks and sim start.
- `quality-gates` - `test:sim` inside the verify plan and the gated paths.
- `git-commits-and-reporting` - the evidence report, Human checks (not blocking) and the Gate-Change trailer.
- `unit-and-component-tests` - the Jest projects, `jest.sim.config.js` and the coverage gates.
- `audio-and-haptics-feedback` - sounds and haptics for the payoff moments the sims find.
