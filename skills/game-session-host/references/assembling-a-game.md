# Assembling a game into the app

The steps that turn a finished game module into a hosted game, and the one-time data layer the host
stores runs through.

## Contents

- Before you start
- The binding
- The tutorial (optional)
- The registry
- Options against rules
- The save policy
- The gameFacing record
- Catalog keys
- The run repository on SQLite
- The tally test game
- Checklist

## Before you start

- The game module exists: `src/games/<id>/<id>-game.ts` exports `<ID>_GAME: GameModule<...>` with
  `identity.id` equal to the folder (game-rules-engine), and its `canvas/intent-to-move.ts` is pure.
- The game has levels (`levels` not `null`) before level, daily or endless runs can open
  (level-generation-and-solvers).
- The board component exists: the game's `Surface` takes `GameSurfaceProps` and lives in
  `src/games/<id>/canvas/<id>-board.tsx` (`<Pascal>Board`). It renders skia-canvas-rendering's surface
  (`canvas/<id>-surface.ts`, the file new-game-scaffold's complete stage requires) and hands touches to
  canvas-gestures-and-hit-testing, which turns them into intents. A real-time board is
  realtime-game-loop's `RealtimeCanvasHost` wrapper in the same folder.

## The binding

`src/games/<id>/<id>-hosted.ts` (`examples/app-wiring/lights-out-hosted.ts`) is assembly only:

```ts
export const LIGHTS_OUT_HOSTED: HostedGame<LightsOutState, LightsOutMove, LightsOutEvent, CanvasIntent> = {
  ...LIGHTS_OUT_GAME,
  Surface: LightsOutBoard,
};
```

The type annotation is the proof: if the module, the Surface's props and the intent type disagree,
`tsc` fails here, in the one file that names the game's types. No logic, no extra members beyond an
optional `tutorial`, no cast (`hosted-binding`, `unsafe-cast`). A real-time game's Surface also uses
the `onSavePoint` prop (session-flow.md, "Real-time games and save points"). Anything else the app needs about a game (a logo, credits, music)
is app content keyed by `identity.id`, not a new member of the binding.

## The tutorial (optional)

A game that teaches itself ships `src/games/<id>/tutorial/<id>-tutorial.ts`
(`examples/app-wiring/lights-out-tutorial.ts`): pure data, a `TutorialSpec<State, Move>` with a
`start()` state and its steps (`{ messageId, expect: { kind: 'move', move } | { kind: 'any-move' } }`),
joined to the binding as `tutorial: <ID>_TUTORIAL`. Each step's sentence is a catalog key in the
game's namespace (`<id>.tutorial.<step>`) in every catalog. The checker loads the file and replays
the steps from `start()` through the game's engine: each expected move must be one `listMoves`
offers at that point (`tutorial-legal`). Keep the tutorial in that file even when the binding could
inline it: the checker can only replay a file it can load headless.

## The registry

`src/games/game-registry.ts` holds one factory per game:

```ts
(deps) => createGameHost(LIGHTS_OUT_HOSTED, { ...deps, options: GAME_HOST_CONFIG['lights-out'] }),
```

Each factory closes over its own typed module and returns an erased `GameHost`, so the list's type is
`readonly ((deps: SharedHostDeps) => GameHost)[]` and needs no cast. `createGameHosts(deps)` is the
only thing the composition root calls (`game-registered`, `host-not-created`).

## Options against rules

`src/config/game-host-config.ts` (`examples/app-wiring/game-host-config.ts`):

| Option | Allowed when | Why |
|---|---|---|
| `isContinueAllowed: true` | the rules have `continueRun: { kind: 'once', ... }` | a Continue the rules cannot apply does nothing |
| `isContinueAllowed: false` | always | the app may switch a rescue off (no ads, a calm mode); the reducer then sees no rescue |
| `freeHintsPerDay > 0` | the rules have `hints: { kind: 'solver', suggest }` | a free hint for a game without hints is a dead button |

The checker loads the config and each module in Node and fails the combinations the rules cannot
honour (`config-rules`). The registry reads the options from this file, never literals
(`continue-from-config`).

## The save policy

Turn-based games save after every move (`savePolicy: { kind: 'after-every-move' }`). A game with a
real-time loop (a `sim/` folder, realtime-game-loop) saves at save points (`{ kind: 'save-points',
points: [...] }`): writing 60 times a second would wear the disk and stall frames (`save-policy`).

## The gameFacing record

A game's code faces only `src/core`, `src/ui`, `src/theme`, `src/i18n`, `src/canvas`, port types and
the seam the host defines (architecture-and-boundaries' `game-facing` rule). The binding imports
`src/services/game-host/hosted-game.ts`, so record it once:

```json
{ "gameFacing": ["src/services/game-host/hosted-game.ts"] }
```

in `contracts/architecture.json` (`game-facing-recorded`; a SKIP until that contract exists). Only
that file: a game never imports the controller, the stores or `useServices()`; the host hands it
values.

## Catalog keys

The host adds no catalog keys of its own; it hands screens the game's keys: `identity.nameId`
(`<id>.name`), the hud goal (`rules.hud(state).goal`), the rescue's `descriptionId`, each lose
`reasonKey` and each counter's `labelId`. They are in every catalog already (game-rules-engine's
`catalog-key-missing`). The Game screen's own texts (Pause, Try again, the result) are app keys
(i18n-strings-and-catalogs).

## The run repository on SQLite

`examples/sqlite-game-runs/` holds the adapter and its migration:

- `v0002-create-game-runs.ts`: `game_saved_runs` (one JSON row per game), `game_results` (best score
  and stars per run key), `game_run_ends` (one row per finished run, with its day, counters and
  `is_practice`; indexed by day and by run key).
  Append it to the app's `MIGRATIONS` with the next free version (persistence-and-migrations: forward
  only, frozen once shipped).
- `sqlite-game-runs-repository.ts`: `recordRunEnd` is one `driver.transaction` (best upserted with
  `max()`, the end row inserted, the saved run deleted, then the app's optional `extendRunEnd` for
  other sections such as a stored streak or the ad history); a practice end (a replayed daily)
  inserts only its row and deletes the run; `hasRunEnd` reads `game_run_ends` by run key; the
  saved-run envelope is validated with
  valibot when read (an unreadable row, corrupt JSON included, reads as no run and is logged, so the
  host clears it alone); SQLite errors become `GameRunsFailure` once, through `toStorageFailure`.
  A tutorial ref is never stored (the schema has no such kind).
- The migration is a new schema version: follow persistence-and-migrations' "Adding version N+1"
  (the step registered in order, then that version's frozen fixture database made with its
  `inspect-database.mjs --dump`, its checksum and its `FIXTURES` entry).

Test it on Node's `node:sqlite` driver (`test/sqlite/node-sqlite-sql-driver.ts`, the same cases as
the fake's test plus a failure in the middle of `recordRunEnd` that must leave every table as it
was). Add `gameRuns` to the app's `AppData` (the device opener creates it) so `GamesRoot` reads it
with `useAppData()`.

## The tally test game

`test/games/tally-game.ts` is a complete, tiny `GameModule`: count up by 1 or 2 to hit the target
exactly (target = 3 + difficulty); going past loses. Unlimited undo, a solver hint, one rescue (back
to target - 1), two counters (`adds` sum, `biggest-add` max), three par levels, a daily and an endless
mode, a two-step tutorial (`TALLY_TUTORIAL`), and a `tray` select region for tap-then-tap. The host's tests and this skill's checker run
against it, never against a real game: a host bug then shows up the same way in every app.

## Checklist

- [ ] `<id>-hosted.ts` is `{ ...<ID>_GAME, Surface[, tutorial] }` typed `HostedGame`; a tutorial
      lives in `<id>/tutorial/<id>-tutorial.ts` and replays legally.
- [ ] The registry has its factory; `GAME_HOST_CONFIG['<id>']` has options its rules honour.
- [ ] The save policy matches the game's kind (turn-based or real time).
- [ ] `gameFacing` lists the seam.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-game-host.mjs . --game <id>` prints `RESULT: PASS`.
