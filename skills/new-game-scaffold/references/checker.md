# The scripts: options, config keys and every rule

`scaffold-game.mjs` (the generator) and `check-game-scaffold.mjs` (the checker) follow the library's
script contract: the repo root is an optional positional argument (default `.`), `--help` prints usage,
exit 0 pass, 1 problems, 2 bad input; the last line is `RESULT: PASS` or `RESULT: FAIL (<n> problems)`;
each problem is `FAIL <file>:<line> [<rule>] <message> Fix: <fix>`. Node 22.18 or newer (type
stripping and `module.registerHooks` load the game module and `app-settings.ts`).

## Contents

- Options
- rn-skills.config.json keys
- What the checker reads
- Generator rules and plan lines
- Checker rules
- SKIP and NOT APPLICABLE
- Troubleshooting

## Options

| Option | Script | Default | Meaning |
|---|---|---|---|
| `--game <id>` | both | checker: every declared game and every folder of the games folder | the game (repeatable in the checker) |
| `--name`, `--hints`, `--continue` | generator | required for a new game; taken from the entry for a declared one | the display name and the two rules answers |
| `--class`, `--pan-mode`, `--levels PxL`, `--daily`, `--endless`, `--lose-reason` | generator | `turn-based`, `none`, `none`, off, off, none | the rest of the design notes |
| `--app` | generator | off | also write the white-label app (needs the `apps` block) |
| `--write` / `--add-missing` | generator | plan only | write when nothing conflicts / write only what is absent |
| `--stage scaffold\|complete` | checker | `scaffold` | the start, or the finished game |
| `--games-dir`, `--catalogs-dir`, `--contract` | both | see below | layout overrides |
| `--json` | checker | off | the problems as one JSON line too |

## rn-skills.config.json keys

`gamesDir` (default `<srcDir>/games`), `gameCatalogsDir` (default `<i18nDir>/catalogs`) and
`gamesContract` (default `<contractsDir>/games.json`), `levelsContract` (default
`<contractsDir>/levels.json`, the key level-generation-and-solvers reads) and `copySource` (default
`<contractsDir>/copy-source.json`, the key i18n-strings-and-catalogs reads), plus check-lib's layout
keys `srcDir`, `i18nDir`, `contractsDir`, `testDir`, `e2eDir`. `gamesDir` and `gameCatalogsDir` are the keys
game-rules-engine reads too, so both skills see the same games. A white-label app's folders come from
its workspace layout (`apps/<id>/src/...`).

## What the checker reads

`contracts/games.json`; every `<catalogsDir>/<locale>.json`; `contracts/copy-source.json` when it
exists (i18n-strings-and-catalogs owns its format); each game folder (`*.ts`, `*.tsx`, tests left out of
the key scan) and, for the placeholder scan, the game's evidence files outside it (below); at the
complete stage `<id>-game.ts` loaded in Node, `rules/**`, game-session-host's fixed
`<gamesDir>/game-registry.ts`, `contracts/levels.json`, `<testDir>/sims/<id>/`, `*.golden.test.ts`
files, `<e2eDir>/**/*.yaml`; for a white-label app its skeleton files, `app-settings.ts` loaded in Node,
the shared fonts and, at the complete stage, its entry (`package.json` `main`, `index.ts`,
`<srcDir>/app/_layout.tsx`). It never scans generated or
vendored folders: `ios/`, `android/`, `build/`, `out/`, Pods, `node_modules`, and any folder holding a
`SKILL.md` (installed skills in `.agents/skills/`, `.claude/skills/`, `skills/`, or a skill vendored
into the games folder hold planted bugs on purpose).

## Generator rules and plan lines

| Line or rule | Means | Fix |
|---|---|---|
| `new <file>` / `same <file>` | absent / already identical | nothing |
| `edit <file> (+ ...)` | only additions: the entry, missing catalog keys | nothing |
| `keep <file>: <why>` | `--add-missing`: an existing value differs and stays | compare by hand if it should change |
| `conflict` | an existing value differs; `--write` writes nothing | `--add-missing`, or align the value by hand |
| `deps-lockstep` | `--app`: the existing apps disagree on their dependencies | bring every app to one set first (dependency-management) |
| exit 2 | a bad id, a missing `--hints`/`--continue`, `--levels` that is not `none` or `<packs>x<levels>` with both at least 1, `--bundle-id`, `--write` with `--add-missing`, `--app` without the apps block or the workspace | the ERROR line names the fix |

`--daily` or `--endless` without `--levels` is accepted: a daily-only or endless-only game ships no
packs, so it is declared with `levels: null`, and its `contracts/levels.json` entry (written in the
levels step) has `"packCount": 0, "levelsPerPack": 0` and no `starRule`. The plan prints the
`contracts/levels.json` entry level-generation-and-solvers will add (packs, or the pack-less form),
and, with a daily level, the game's default daily salt: FNV-1a of the id folded to 16 bits, the same
value level-generation-and-solvers' checker prints (`0x7c9e` for `lights-out`).

## Checker rules

Both stages:

| Rule | Checks | Fix |
|---|---|---|
| `declaration` | the contract exists and parses, holds only the schema's keys (top level, each entry, the apps block; read from the shipped `games.schema.json`, so a key a revision dropped, such as an old `registry`, is reported), declares every game folder, each entry is well-formed (`levels` is `null` or `{ packs >= 1, levelsPerPack >= 1 }`), the apps block is complete | `scaffold-game.mjs --add-missing`, or correct or remove the field |
| `catalogs` | each catalog is a flat JSON object of strings; no `<id>.*` text is empty; a catalogs folder exists (white-label: always) | fix the file; write the text |
| `catalog-keys` | every locale has every `<id>.*` key any locale has; each gap is reported on the catalog that lacks it, naming the catalogs that have it | add the missing keys in every language, or delete a key everywhere |
| `catalog-missing-key` | `<id>.name`, each declared `<id>.lose.<reason>` and every `<id>.*` literal in the game's code are in every catalog | add them (`--add-missing` adds the name and lose keys) |
| `copy-source-text` | a `<id>.*` key of the approved copy has the copy's text | i18n-strings-and-catalogs' copy sync |
| `retired-key` | no retired `<id>.*` key is in a catalog or the code | use its replacement |
| `placeholder-left` | no `__UPPER_SNAKE__` token (platform names excepted) in the game folder, or in the whole app when white-label; in a single app also in the game's evidence files outside its folder: `<testDir>/sims/<id>/**`, the board golden (`<id>*.golden.test.ts` under `<testDir>/goldens/`) and every flow under `<e2eDir>` named after the game | fill it from the scaffold's table |
| `new-game-script` | a declared `new-game` npm script runs a file that exists | copy `templates/scripts/games/` |

White-label app (both stages): `app-file-missing`, `package-json`, `deps-lockstep`, `tsconfig`,
`metro-cache`, `app-config`, `gitignore`, `app-settings`, `settings-null`, `bundle-id`, `product-id`,
`fonts` (each explained in `white-label-apps.md`). At the complete stage `app-file-missing` no longer
asks for the placeholder `index.ts`.

Complete stage only:

| Rule | Checks | Fix |
|---|---|---|
| `part-missing` | rules types, `create`, `list-moves`, `apply-move`, `outcome`, tuning, engine, persistence, stats, testing (game-rules-engine); `canvas/intent-to-move.ts` (canvas-gestures-and-hit-testing); the surface `canvas/<id>-surface.ts(x)` (skia-canvas-rendering; for a real-time game a `canvas/draw-*.ts` also counts); `<id>-game.ts` and `<id>-game.test.ts`; the hosted binding `<id>-hosted.ts` (game-session-host); `levels/<id>-levels.ts` when the game has packs, a daily or an endless mode (level-generation-and-solvers); for a real-time game `sim/` and `<id>-realtime.ts` (realtime-game-loop) | build it with the named skill |
| `evidence-missing` | `<testDir>/sims/<id>/*.sim.test.ts`, a `*.golden.test.ts` named after the game, an E2E `.yaml` named after the game | add it with the named skill |
| `host-registration` | `<gamesDir>/game-registry.ts` imports `<CONST>_HOSTED` from `@/games/<id>/<id>-hosted` (or `./<id>/<id>-hosted`) and calls `createGameHost(<CONST>_HOSTED, ...)` | add the factory (game-session-host): `(deps) => createGameHost(<CONST>_HOSTED, { ...deps, options: GAME_HOST_CONFIG['<id>'] })` |
| `module-load` | `<id>-game.ts` and its imports load in Node (pure TypeScript) | move React Native, Expo and Skia imports out of the module's graph |
| `declaration-mismatch` | the module: `class` is `realtime` exactly when the module has a `realtime` member; `input.panMode`, `rules.hints.kind`, `rules.continueRun.kind`, `levels` packs (none for `levels: null`), pack count, levels per pack, `daily` and `endless` equal the entry. `contracts/levels.json` (level-generation-and-solvers): a game with packs has an entry there with the same `packCount`, `levelsPerPack`, `daily` and `endless`; a daily- or endless-only game (`levels: null`) has one with `packCount` 0 and `levelsPerPack` 0; a game with no packs and no mode has none | correct whichever side is wrong; commit both contracts together |
| `lose-reasons` | every `<id>.lose.<reason>` the rules return is declared, and every declared reason is returned by some rules file | declare it, or drop it |
| `entry` | white-label: the app starts its real root: `index.ts` no longer registers `PlaceholderApp`; `main` is `index.ts` with an `index.ts` that imports `expo-router/entry` (after the forced Intl polyfills, the default) or `expo-router/entry` (an app without forced polyfills); and `<srcDir>/app/_layout.tsx` exists (app-startup-and-bootstrap creates it) | build the root, replace the placeholder `index.ts` with app-startup-and-bootstrap's entry |
| `ship-placeholder` | white-label: no placeholder bundle id, product, link, address or AdMob id in `app-settings.ts` | a human supplies the value; never a pass |

## SKIP and NOT APPLICABLE

A passing scaffold stage prints at most
`SKIP src/i18n/catalogs [catalog-missing-key] not yet created (i18n-strings-and-catalogs creates it)`
in an app without catalogs yet. An app without any game prints
`NOT APPLICABLE: the app has no game (contracts/games.json declares none and src/games has no game folder)`
at the scaffold stage. The complete stage is a completeness gate: no SKIP, no NOT APPLICABLE, and for
an app without a game it exits 2 (`nothing to check`).

## Troubleshooting

- **`module-load` cannot load the module:** when the module's import graph reaches React Native,
  Expo or Skia, the line names the chain of files and the package (`lights-out-game.ts ->
  rules/outcome.ts imports expo-haptics`); Node's own error after it comes from the package's source
  (`Unexpected token 'typeof'` for `react-native`). A type-only import is never the cause. Keep `<id>-game.ts`, the rules, the levels and `canvas/intent-to-move.ts` pure; the surface is
  joined to the module only in `<id>-hosted.ts` (`{ ...<CONST>_GAME, Surface }`, game-session-host),
  which the module never imports.
- **"declares the way of losing … but no rules file returns" although the rules do:** the key scan
  (lose reasons and `catalog-missing-key`) reads whole string literals only. A key built at run time,
  such as `` `${GAME_ID}.lose.time-up` `` or `'lights-out.' + 'lose.time-up'`, is invisible to it, so
  the reason looks unreturned and the key looks unused. Write every message key as one whole literal
  (`'lights-out.lose.time-up'`), the convention game-rules-engine's templates already follow.
- **`npm run new-game` says it cannot find the generator:** `scripts/games/find-generator.ts` looks
  for this skill in `.agents/skills/`, `.claude/skills/` and `skills/` of the repo. A skill installed
  through the Claude Code plugin marketplace lives in the plugin cache outside the repo, so the npm
  script cannot see it. Run the generator directly (`node <skill dir>/scripts/scaffold-game.mjs . --game
  <id> ...`, the skill dir being the folder of this skill's SKILL.md), or vendor the skill into the repo
  (`npx skills add`) so the script finds it.
- **`declaration-mismatch` after tuning:** the design changed. Change the entry in the same commit as
  the code, and mention it in the report: the entry is what reviewers read.
- **`catalog-missing-key` right after copying a template:** the template names keys the catalogs lack;
  add them in every language (game-rules-engine lists the keys its templates use).
- **A game folder you did not create shows up:** a folder in the games folder without a `SKILL.md` is a
  game. Move tooling elsewhere, or declare it.
