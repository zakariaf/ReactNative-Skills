# check-rules-engine.mjs: rules, options and output

The one checker of this skill. It reads the kit, the RNG and every game's folder statically, then
imports the real rules modules (Node type stripping, tsconfig aliases) and plays seeded games.

## Contents

- Invocation and options
- What it reads
- Rules
- Expected SKIP and NOT APPLICABLE lines
- When multi-package
- Troubleshooting

## Invocation and options

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs [repo-root] [--game <id>]... [--games-dir <dir>]
     [--core-dir <dir>] [--catalogs-dir <dir>] [--no-run] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `--game <id>` | every `<games-dir>/<id>` holding `rules/` | Check only these games (repeatable); a named game without a rules folder is a problem. |
| `--games-dir` | `gamesDir` in `rn-skills.config.json`, else `<srcDir>/games` | Where the games live. |
| `--core-dir` | `coreDir` of the layout (`src/core`) | Holds the kit (`game/`) and the RNG (`rng/`). |
| `--catalogs-dir` | `gameCatalogsDir` in `rn-skills.config.json`, else `<i18nDir>/catalogs` | The app's `<locale>.json` message catalogs. |
| `--no-run` | off | Skip the parts that run code (the RNG goldens and the seeded engine run). |
| `--json` | off | Also print the problems as one JSON line. |

`rn-skills.config.json` keys this skill reads: `gamesDir`, `gameCatalogsDir` (plus check-lib's layout
keys `srcDir`, `coreDir`, `i18nDir`). Exit 0 pass, 1 problems, 2 bad input (an option pointing outside
the repo, a missing root). Node 22.18 or newer (type stripping and `module.registerHooks`).

## What it reads

- `<core>/game/**` (the kit) and `<core>/rng/sfc32.ts` with its test.
- Each game: `<games-dir>/<id>/rules/**`, `testing/<id>-testing.ts`, `<id>-game.ts`, its tests and
  `canvas/intent-to-move.ts` (existence only). A game folder holding a `SKILL.md` (a vendored skill) is
  never a game; folders holding a `SKILL.md` are pruned from every scan, and installed skills
  (`.agents/skills/`, `.claude/skills/`, `skills/`) are outside the scanned folders.
- The root `package.json` (the fast-check pin) and every `<catalogs-dir>/*.json`.

## Rules

| Rule | Checks | Fix |
|---|---|---|
| `kit-file-missing` | each kit file and `src/core/rng/sfc32.ts` + test exist | copy the template verbatim |
| `kit-export-missing` | each kit file exports its names | restore the template |
| `kit-member-missing` | an older kit copy (no `selectRegions`/`GameIntent`, no solver `final`, no `endless`/`input` in the contract run) | copy the template again, fix what tsc reports |
| `kit-test-dependency` | fast-check is an exact pin in the root `devDependencies` when kit, RNG or rules tests import it | `npm install -D -E fast-check@4.10.2` (verified on 2026-10-03; re-verify: `npm view fast-check version`) |
| `rng-worklet` | `sfc32.ts` starts with `'worklet';` | restore the canonical file |
| `rng-load` / `rng-golden` | the real `sfc32.ts` equals PractRand's reference for 50 draws and the goldens | restore the canonical file |
| `rng-golden-test` | `sfc32.test.ts` pins the `seedRng(1)` sequence and `hashSeed('tasks:2026-09-26')` | restore the canonical test |
| `pure-import` | kit and rules import no React, React Native, Expo, Skia, state library, `node:`, and no local file outside `src/core` and the game's own `rules/`, `levels/`, `geom/` (rules tests: the game folder) | pass values in; move shared logic to `src/core` |
| `determinism` | no `Math.random`, `Date`, `performance.now`, `Intl`, `toLocale*`, `localeCompare`, `**`, inexact `Math.*` (tests: no clock, no randomness) | the policy in `determinism-and-rng.md` |
| `rules-file-missing` / `rules-export-missing` | `<id>-types.ts` and one file per engine function, each exporting it | write it test-first from the template |
| `state-not-json` | no `Map`, `Set`, `Date`, `bigint`, `symbol`, typed array (`Uint8Array`, `Float64Array`, ...), `ArrayBuffer`, `DataView` or class in the types file | plain data |
| `rng-not-in-state` | rules that draw after `create` keep `RngState` in the state | thread `state.rng` |
| `event-kind` | `<Pascal>Event` kinds are past-tense kebab-case | name what happened |
| `illegal-move-throws` | `applyMove` throws `RangeError` | throw, never return the old state |
| `reason-key` | lose reasons are `<id>.*` keys | `<id>.lose.<reason>` |
| `catalog-key-missing` | every `<id>.*` key in the rules and the module is in every catalog | add it to each `<locale>.json` |
| `property-tests` / `pinned-golden` | a `fc.assert`, a JSON round trip (or a contract run), a `GOLDEN_*` constant in the rules tests | the checklist in `testing-rules.md` |
| `engine-missing` / `engine-typed` / `engine-contract-test` | `rules/<id>-engine.ts` typed `GameEngine` + `GameRules`, naming every member, with a test running `engineContractProblems` (required once the module exists) | copy the template |
| `persistence-missing` / `persistence-members` | the persistence file and its five members (required once the module exists) | copy the template |
| `stats-missing` / `stats-counters` | the stats file, 2 to 4 kebab-case counters with `<id>.*` labels | copy the template |
| `module-missing` | `canvas/intent-to-move.ts` exists but `<id>-game.ts` does not | assemble from `examples/lights-out-module/` |
| `module-typed` / `identity-id` | `<id>-game.ts` is a typed `GameModule` naming every member; `identity.id` is the folder name | the example |
| `pan-mode` / `select-regions` | `panMode` is a literal of the four and `selectRegions` is set, in the module | the example |
| `module-contract-test` | a test beside the module runs `engineContractProblems` with `input` | copy `lights-out-game.test.ts` |
| `placeholder-left` | no `__GAME_*__` placeholder in a game file | fill the placeholders |
| `engine-load` | the rules modules load headless | rules import only `src/core` and their folder |
| `engine-contract` | seeds 1-3 x difficulty 0, 50, 100, random play and the game's bot: start in play, determinism, JSON-safe states and moves, pure `applyMove`, kebab-case events, moves empty exactly at the end, whole win scores, `<id>.*` reasons, identical replays | add the failing seed as an example test, then fix the engine |
| `persistence-roundtrip` | parsers return every played state and move unchanged | rebuild a fresh typed value |
| `testing-bot` / `testing-examples` | the bot picks offered moves; `start`/`middle` play, `win` is won, `lose` is lost | fix the testing file |
| `endless-won` | a game that declares an endless mode never wins at difficulty 100 | check `isEndlessDifficulty` before the win |

## Expected SKIP and NOT APPLICABLE lines

- `SKIP src/games/<id>/canvas/intent-to-move.ts [module-missing] not yet created (canvas-gestures-and-hit-testing creates it)`:
  the game has rules but no canvas surface yet; the module checks wait for it.
- `SKIP src/i18n/catalogs [catalog-key-missing] not yet created (i18n-strings-and-catalogs creates it)`:
  the app has no catalogs folder yet.
- `NOT APPLICABLE: the app has no game (no src/games/<game-id>/ folder with rules, testing, canvas or <game-id>-game.ts, and no src/core/game kit)`:
  an app without the games plugin. The reference Tasks app prints this.

## When multi-package

Every folder option is relative to the repo root you pass and may not contain `..`, so pick the root
that holds both the kit and the games:

- **The kit is a workspace package** (`packages/play-kit/src/game/`, `packages/play-kit/src/rng/`):
  run `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs . --core-dir packages/play-kit/src
  --games-dir apps/puzzles/src/games --catalogs-dir apps/puzzles/src/i18n/catalogs` from the
  workspace root, once per app that holds games.
- **The kit sits inside the app** (`apps/puzzles/src/core/game/`): run once per app with the app folder
  as the root (`node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs apps/puzzles`).

All of an app's games live in one `<games-dir>/<game-id>/` folder each. tsconfig `paths` and the
workspace package names resolve the imports when the rules run; a module that cannot load is an
`engine-load` problem naming the import.

## Troubleshooting

- **`engine-load: Cannot find package 'react-native'`**: a rules file (or something it imports) pulls
  in a platform module; the same import is a `pure-import` problem with its line.
- **`engine-contract ... listMoves has 2 moves while outcome is won`**: `listMoves` does not check the
  outcome first.
- **`persistence-roundtrip`** right after adding a field: `parseState` does not copy the new field.
- **`testing-examples: examples.win() is playing`**: build the example from `create()` and set the
  fields that make it won, then check it with the same `outcome`.
