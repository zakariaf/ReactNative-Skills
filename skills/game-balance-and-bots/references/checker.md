# The checker: check-balance.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-balance.mjs [repo-root] [--game <id>] [--release]
     [--games-dir <dir>] [--core-dir <dir>] [--sims-dir <dir>] [--reports-dir <dir>] [--json]
```

Zero dependencies (Node 22.18 or newer), read-only, run from the app repo root after
`npm run test:sim`. Exit 0 with `RESULT: PASS` (SKIP lines and NOT APPLICABLE count as a pass), 1 with
`RESULT: FAIL (<n> problems)`, 2 for bad input (`ERROR [bad-input]`). Every problem line is
`FAIL <file>:<line> [<rule>] <message> Fix: <fix>`.

## Contents

- Where it looks
- Rules
- Expected SKIP, NOT APPLICABLE and HUMAN CHECK lines
- What the text rules cannot see
- Troubleshooting

## Where it looks

| Folder | Default | Option | rn-skills.config.json key |
|---|---|---|---|
| Games | `<srcDir>/games` (`src/games`) | `--games-dir` | `gamesDir` (shared with game-rules-engine) |
| Pure core (kit, RNG, balance harness) | `<coreDir>` (`src/core`) | `--core-dir` | `coreDir` (check-lib layout key) |
| Sims, bands and the report writer | `<testDir>/sims` (`test/sims`) | `--sims-dir` | `simsDir` |
| Sim reports | `reports/sim` | `--reports-dir` | `simReportsDir` |

Path aliases come from the root `tsconfig.json` `paths` (`@/*` → `src/*` by default). A game is a
folder of the games folder holding `rules/` or `sim/`; a folder holding a `SKILL.md` (an installed or
vendored skill) is never a game, and repo scans prune installed skills (`.agents/skills/`,
`.claude/skills/`, `skills/`, ...). The report writer's `SIM_LAYOUT` must name the same folders, or
every report reads as stale.

## Rules

| Rule | What it checks |
|---|---|
| `sim-config` | `jest.sim.config.js` (node environment, `*.sim.test.ts`), the `test:sim` script, sims kept out of `npm test` |
| `harness-missing` | the six `src/core/game-balance/` modules with their tests and `test/sims/write-sim-report.ts` with its test exist; once `src/core/game/` exists, its `testing/play-bot.ts` too |
| `harness-outdated` | the writer exports `fingerprintFiles` (the import-closure fingerprint) |
| `sim-missing` | every game has `test/sims/<id>/*.sim.test.ts` |
| `sim-location` | a `*.sim.test.ts` that imports `node:*` lives under the sims folder, never in app source |
| `sim-determinism` | sims and bot hooks use no `Math.random`, `Date`, `performance.now`, retries, skips or focus |
| `sim-seeds` | each sim plays seeds 1..seedsPerCell (`seed: index + 1` over `Array.from({ length: BANDS.seedsPerCell })`) |
| `sim-harness` | each sim imports the balance harness, calls `writeSimReport` and asserts `bandProblems` |
| `bot-missing` | `testing/` exports an event tagger (a function returning `EventTag[]`) and a `BotPolicy` or, real-time, a `SimBotGame` and a `CommandPolicy`; game-rules-engine's starter `greedyBot` in the testing spec alone does not count |
| `fingerprint-scope` | value imports from `rules/`, `levels/`, `sim/`, `geom/`, `testing/` reach only those folders and the core |
| `bands-missing`, `bands-invalid` | the bands file exists, is complete and consistent (metrics, rules, >= 100 seeds, a grid of 0..99, an endless block at 100, approved bands dated, `gameId` = folder) |
| `bands-unapproved` | `--release` only: a HUMAN CHECK line, never a problem |
| `tuning-missing`, `tuning-undocumented` | `rules/<id>-tuning.ts` (real-time: `sim/<id>-tuning.ts`) exists and every knob has a comment (a key documented on a knobs type counts; table rows are values) |
| `report-missing`, `report-invalid` | the report exists, has the right shape, is for this game and ran the bands' seeds and cap |
| `report-stale` | the report's fingerprint matches the code (logic folders, the sim, the core files they import; not the generated `levels/pack-*.json`) |
| `report-cell-missing` | every grid cell and the endless cell are in the report |
| `cap-hit` | no run hit `maxMoves` (grid cells and the endless cell) |
| `band-violated` | every band (and every endless band) holds |
| `curve` | the curve moves in its direction by at least `minStep` per level |
| `skill-gap` | each policy in `order` beats the previous one by at least `minStep` |
| `first-payoff` | the kill test: the first payoff within `withinMoves` in at least `minShare` of runs |
| `twist` | the twist happens at least `minPerRun` times per run |
| `endless-won` | the endless cell has no won run |

## Expected SKIP, NOT APPLICABLE and HUMAN CHECK lines

- `NOT APPLICABLE: the app has no game (no src/games/<game-id>/ folder with rules/ or sim/)`: games
  are an optional plugin; an app without a game passes.
- `SKIP src/core/game/testing/play-bot.ts [harness-missing] not yet created (game-rules-engine creates it)`:
  the kit's minimal bot loop belongs to game-rules-engine; the line shows only while `src/core/game/`
  does not exist at all. Once the kit folder exists, a missing `play-bot.ts` is a `harness-missing`
  problem (the rules and testing specs came from that skill, so its kit should be complete).
- With `--release` and proposed bands, one line per game:
  `HUMAN CHECK (not blocking) test/sims/<id>/balance-bands.json:3 [bands-unapproved] ...`. Copy it
  into the release report's "Human checks (not blocking)" list. Nothing waits for it.

## What the text rules cannot see

- `bot-missing` reads the testing folder's text: an event tagger typed through an alias (`type Tags =
  readonly EventTag[]`) or hooks that live outside `testing/` are not seen. Keep the hooks in
  `testing/<id>-bot.ts` with the explicit return type, as the template does.
- `fingerprint-scope` scans the game's logic folders (`rules/`, `levels/`, `sim/`, `geom/`,
  `testing/`), not the sim files under `test/sims/<id>/`. A sim that imports a game file outside the
  fingerprint (`@/games/<id>/ui/...`, `@/features/...`) is not flagged, and a change to that file does
  not make the report stale. The template sim imports only logic folders and the balance harness;
  keep it that way, and move anything a sim needs into `rules/` or `testing/`.
- `sim-seeds` accepts the template's form (`seed: <index> + 1` with `length: ...seedsPerCell`); a sim
  written in a very different style fails it and must follow the template.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `report-stale` right after `npm run test:sim` | The writer and the checker fingerprint different files: a moved games folder (`gamesDir`), another core folder, an alias the writer's `SIM_LAYOUT` does not know. Make `SIM_LAYOUT` and `rn-skills.config.json` agree, rerun the sims. |
| `report-stale` after editing only a unit test | It cannot be: unit tests are not fingerprinted. Look for a changed source file in the logic folders or a core file they import (`git status`). |
| `report-stale` after a later build step | A rules or sim file now imports a new core file (it joined the closure): rerun the sims. New core files nothing imports leave the report fresh. |
| `fingerprint-scope` on an import of the game's own canvas or board | Move the shared table or helper into `rules/` or `geom/`; drawing code may import the rules, not the reverse. |
| `sim-seeds` on a sim with its own seed list | Seeds are 1..seedsPerCell in every game: a chosen seed list can shop for good numbers. Raise `seedsPerCell` for more confidence instead. |
| `tuning-undocumented` on a wrapped table row | The row must sit inside `[ ... ] as const satisfies readonly <Type>[]`; document the key once on the knobs type. |
| exit 2 `nothing to check: no src/games/<id>/rules or sim folder` | `--game` names a folder that is not a game; the message lists the games found. |
