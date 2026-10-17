---
name: game-session-host
description: "Hosts a game module through one typed seam: game screen, pause, undo, hints, a rescue, saved runs, results. Use when assembling a game or wiring the Game screen or registry. Not for rules (game-rules-engine)."
---

# Game session host

Makes every game playable inside the app the same way: the typed game module enters through one
generic seam (`createGameHost`), each run lives in a per-run store that writes the run before the
board animates it, a finished run is recorded in one repository transaction before its result
shows, and screens see only plain data and commands. The skill ships the host (templates), the
wiring around it (examples) and a checker that proves the invariants by running the app's own host
modules against a tiny test game, on iOS and Android alike (the host is pure TypeScript and React).

## Rules that must hold

1. **`createGameHost(game, deps)` is the only place the app touches a game's own types.** Screens,
   routes, UI, stores and shared hooks use the erased `GameHost`, `SessionHandle` and
   `SessionView`; only the registry (`src/games/game-registry.ts`) names a game, one factory per
   game; no cast anywhere in the seam. Why: TypeScript cannot hold "a module of some type" without
   a cast (strictFunctionTypes makes the intent parameter contravariant), and a cast hides exactly
   the errors the compiler exists to catch. (`unsafe-cast`, `screens-type-erased`)
2. **Every change is reduced, persisted, then published.** The per-run store calls its persist step
   before `set()`; a failed write publishes nothing and the view shows `saveFailure` so the screen
   offers a retry. Why: iOS and Android end background apps without warning; a kill during an
   animation must reopen the exact state on screen. (`save-before-publish`, `save-failure-shown`)
3. **Only the game's `intentToMove` makes moves; `null` means nothing happens.** The reducer ignores
   moves while paused or decided, and undo never steps out of a loss; screens send commands (undo,
   hint, continue, pause, finish, leave), never moves. Why: bots, solvers and players share one
   legality, and no illegal state can be saved. (`intent-legality`, `moves-only-while-playing`,
   `undo-not-after-loss`)
4. **A run ends in ONE repository transaction, before its result shows:** the result row, the best,
   the statistics and counters, and the saved run cleared (`recordRunEnd`). The move that decided
   the run then plays the win or lose feedback once. Why: a result on screen that is not on disk
   breaks trust, streaks and statistics. (`run-end-once`, `result-feedback`)
5. **At most one rescue per run, only after a loss, only when the rules have one and the app's config
   allows it** (`src/config/game-host-config.ts`, never a literal). A rescuable loss stays saved and
   unrecorded until the player continues or declines (`finish`); a new run of the same game first
   records a decided saved run (declined) and, if that write fails, writes nothing. Why: a Continue
   the rules cannot honour does nothing, and an abandoned loss must still reach results and streaks.
   (`continue-once`, `rescue-pending`, `abandoned-run-recorded`, `config-rules`, `continue-from-config`)
6. **Never strand a finished run.** A pending loss whose rescue offer is `'hidden'` (ads off,
   offline, no consent, no Premium) is finished at once: the Game screen's model sends
   `{ type: 'finish' }` once per `eventSeq` when `isLossStranded(view, offer)`; a loading ad is
   `'loading'`, never hidden. Why: an endless run in an ads-off build otherwise never shows its
   result and is never counted. (`loss-not-stranded`, `game-screen-wiring`)
7. **A saved run is validated by the game's own parsers at boot and on resume.** An unreadable run is
   dropped alone and logged (results stay); a replay that differs from the snapshot keeps the
   position and drops only the undo history; a resumed run starts paused. Why: one damaged row must
   never cost progress or crash the app. (`saved-run-validated`)
8. **Hosts are created once, in the composition root, after the data layer opened, never at import
   time or in a render** (a `useState` initializer), and provided once (`GameHostsProvider` inside
   the navigation theme). Opening a run writes nothing (dropping an unreadable saved run is the one
   idempotent exception); its handle `begin()`s in `useGameSession`'s effect.
   Why: a host reads and validates saved runs, and a render React repeats (StrictMode) must write
   nothing. (`host-not-created`, `host-at-import`, `host-in-render`, `host-not-provided`)
9. **The Game screen opens its run with `useGameSession`, renders the host's `BoardHost`, pauses on
   background, blur or a full-screen ad, and guards Back with `backCommandOf`.** iOS reports
   `inactive` (app switcher, calls) and keeps `active` under a Google full-screen ad; Android
   reports only `background`; all pause, and Pause shows afterwards on both. Back (header, iOS
   swipe, Android button, predictive back) is caught with `usePreventRemove` while the run is live
   and unrecorded: pause in play, resume in Pause, finish a pending loss; Pause -> Home sets a
   leaving flag first so the guard lets that one removal through. Why: coming back must show Pause,
   and only Pause -> Home leaves a live run. (`game-screen-wiring`, `back-guard`)
10. **Paid perks are sent only after payment, and offered only when they can be given:** a hint or a
    continue is sent when the rewarded ad completed, the allowance was spent or the player owns
    Premium (the monetization layer's `pay(then)`); the hint is offered only while
    `view.isHintAvailable`. Why: a perk granted before the ad completes is free forever, and a paid
    hint with nothing to show is wasted. (Proven by the Game screen's model test.)
11. **A tap-then-tap selection is UI state of the board host, never a move.** A tap in one of
    `input.selectRegions` toggles it, the next tap reaches `intentToMove` with `selected` filled in,
    and any new move, undo, rescue, run end or drag clears it. Why: bots, solvers, par, undo and the
    counters must never see a selection. (`board-host-model.test.ts`; `intent-legality`)
12. **Stars come from the level's own star rule, counters from the kept moves, play time only while
    playing** (each step clamped to 0..300,000 ms), and the first finished attempt of a daily is the
    day's result: a replay is practice (`isPractice`: no new best, no statistics, no streak). Why:
    undone moves must not count, a phone asleep on the result screen must not add hours, and a
    replayed daily must not rewrite the day. (`stars-from-table`, `counters-from-log`, `play-time`,
    `daily-practice`)
13. **Each game is one binding, registered, with its options and save policy right:**
    `src/games/<id>/<id>-hosted.ts` is `{ ...<ID>_GAME, Surface[, tutorial] }` typed `HostedGame`,
    the registry hosts it, its options promise nothing its rules lack, a game with a real-time loop
    (`sim/`) saves at save points and a turn-based one after every move, and
    `contracts/architecture.json` `gameFacing` lists the seam. Why: the binding is the one place the
    app types a game. (`hosted-binding`, `game-registered`, `save-policy`, `game-facing-recorded`)
14. **A real-time game saves through the host at its save points:** its board calls
    `onSavePoint(realtime.snapshot(copy), inputLog)` at each save point and at the run's end; the host
    writes it through the same persist step (never per move) and records the run once when that
    state decides it. Why: a direct write would bypass the store and the run-end transaction.
    (`save-point-write`)
15. **A tutorial (optional) plays its script beside the saved run, in memory:** each step accepts
    only its expected move, nothing is written or recorded, and every step is legal from its start.
    Why: replaying the tutorial must never cost the player their run or count in statistics.
    (`tutorial-beside-run`, `tutorial-legal`)
16. **Test-build shortcuts end runs through the same persist step as real play** and reach only the
    debug layer (`host.debugControls()`), never store builds. Why: an E2E flow must see the real
    run-end write and the real result. (`debug-run-end`)

## Workflow

1. **Check what exists.** Run `node ${CLAUDE_SKILL_DIR}/scripts/check-game-host.mjs .`. It prints
   NOT APPLICABLE until the app has a game. The game's rules and module come first
   (game-rules-engine: `src/core/game/` and `src/games/<id>/<id>-game.ts`); levels make level,
   daily and endless runs possible (level-generation-and-solvers). Read
   [references/host-architecture.md](references/host-architecture.md) for the seam and the files.
2. **Install the host once per app.** Copy `templates/` into the repo at the paths line 1 of each
   file names: `src/services/game-host/`, `src/stores/game-session/`, `src/data/game-runs/`
   (the port and its fake), `src/core/game-results/`, `src/hooks/use-pause-on-background.ts` and
   `test/games/` (the tally test game). `templates/src/core/game/` holds synced copies of
   game-rules-engine's kit and level-generation-and-solvers' `level-kit/star-rating.ts` and
   `level-kit/daily-start.ts`: keep the copies the app already has. Run `npm run typecheck` and
   `npx jest src/services/game-host src/stores/game-session src/data/game-runs --ci --coverage --coverageThreshold='{}'`.
3. **Store runs in the data layer.** Add a SQLite `GameRunsRepository` from
   `examples/sqlite-game-runs/` and hand it down with the app's data (`useAppData()`). Its migration
   is a new schema version (persistence-and-migrations, "Adding version N+1"): register the step,
   then add that version's frozen fixture database, its checksum and its `FIXTURES` entry, or the
   "every shipped version has a fixture" test fails.
4. **Wire the composition.** Read "The composition" in host-architecture.md. Write
   `src/games/game-registry.ts`, `src/config/game-host-config.ts` and the games root from
   `examples/app-wiring/`, and mount `GamesRoot` inside the navigation theme (app-startup-and-
   bootstrap's provider order). Prove the providers with one render test through the real root.
5. **Assemble each game.** Read [references/assembling-a-game.md](references/assembling-a-game.md):
   the binding (`examples/app-wiring/lights-out-hosted.ts`), its registry factory, its options from
   its rules, its save policy, its optional tutorial (`examples/app-wiring/lights-out-tutorial.ts`),
   and `"gameFacing": ["src/services/game-host/hosted-game.ts"]` in
   `contracts/architecture.json` (architecture-and-boundaries).
6. **Build the Game screen** from `examples/game-screen/` (the model hook, the view, the thin route):
   read [references/session-flow.md](references/session-flow.md) first. In navigation-and-routing's
   `contracts/navigation.json`, list the route in `routes`, its params parser in `paramParsers`, and
   `{ "route": "game/[gameId]", "hook": "src/features/game/use-game-model.ts", "gesture": "off" }` in
   `guarded` (`hook` is required: the file that calls `usePreventRemove`), with `gestureEnabled:
   false` and `fullScreenGestureEnabled: false` in the route's screen options. Copy the model's route
   test (`examples/game-screen/use-game-model.test.tsx`: Back per `backCommandOf`, Pause -> Home
   leaves in one tap) and add the perk cases (perks only after payment, a stranded loss finished
   once, a full-screen ad pauses).
7. **Format, lint, type-check and test:** `npx eslint --fix` and `npx prettier --write` on the
   changed files, `npm run typecheck`, `npx eslint --max-warnings 0`, then the Jest run of step 2
   plus `src/features/game`.
8. **Run the check** `node ${CLAUDE_SKILL_DIR}/scripts/check-game-host.mjs . --game <game-id>`; fix
   every `FAIL` line (file, rule, fix) and rerun until it prints `RESULT: PASS`.
9. **Get device evidence** (the kill test: move, kill during the animation, relaunch lands paused in
   the same state; a full level to its result) on a named iOS simulator and a named Android emulator
   (session-flow.md, "Device evidence"; ios-simulator-build, android-emulator-build, e2e-maestro).
   Report what works, what was verified and what still needs the developer (ads, purchases, feel).

## Definition of done

- [ ] Every host template is in place with its test; the host's Jest run passes.
- [ ] A SQLite `GameRunsRepository` records a run end in one transaction (its test runs on Node's
      `node:sqlite` driver).
- [ ] The registry hosts every game, the config gives each game options its rules can honour, and
      `GamesRoot` creates the hosts once after the data layer opened; a root render test passes.
- [ ] Each game has its `<id>-hosted.ts` binding and `gameFacing` lists the seam; a game with a
      tutorial keeps it in `src/games/<id>/tutorial/<id>-tutorial.ts`; a real-time board sends its
      save points through `onSavePoint`.
- [ ] The Game screen opens its run with `useGameSession`, renders `BoardHost`, pauses on background,
      blur and full-screen ads, guards Back with `backCommandOf`, sends perks only after payment and
      finishes a stranded loss; its model test proves the last three.
- [ ] The kill test and a full level to its result pass on a named iOS simulator and Android emulator.
- [ ] `npm run typecheck`, `npx eslint --max-warnings 0` and `npx prettier --check` pass.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-game-host.mjs . --game <game-id>` prints `RESULT: PASS`
      (expected SKIP lines: `src/features/game [game-screen-wiring]` before the Game screen exists,
      `contracts/architecture.json [game-facing-recorded]` before architecture-and-boundaries made it).

## Anti-patterns

- **`game as unknown as HostedGame<unknown, ...>` to keep games in a list or a context.** Keep one
  factory per game in the registry; each closes over its typed module and returns an erased host.
- **Animating first and saving in an effect afterwards.** A kill during the animation loses the move;
  the persist step runs inside the store's dispatch, before `set`.
- **Writing the result, the best and the statistics in three calls, or after the result mounted.**
  One `recordRunEnd` transaction inside the persist step, then publish.
- **Recording a loss the moment it happens while a rescue is on offer,** or keeping it pending while
  the offer is hidden. Keep it saved and pending; finish it as soon as nobody can rescue it.
- **Calling `applyMove` or dispatching `apply-move` from a screen, or a `select` move in the rules.**
  Screens send commands; the board host routes intents; the selection is UI state.
- **Sending `hint` and then showing the rewarded ad.** Pay first; send when the perk is paid for.
- **Creating hosts at module level or in a render.** Create them once in a `useState` initializer of
  the games root, below the data and services providers.
- **Writing a run while opening it** (in a `useState` initializer or a render). Opening writes
  nothing; the handle's `begin()` writes from an effect, so StrictMode's second render writes nothing.
- **Overwriting the saved run with a new one without looking at it.** A pending loss left behind
  (Back, a crash, Home) is recorded first; a failed record blocks the overwrite.
- **A real-time screen calling `writeRun` at its save points.** Send `onSavePoint(state, log)`
  through the board host: the store, the save policy and the one run-end write stay in charge.
- **A tutorial controller with the real repository, or a tutorial run as the debug target.** The
  tutorial writes and records nothing and is never the active run.
- **Guarding Back only while playing.** Back in Pause or on a pending loss would drop a live run.
- **A literal `isContinueAllowed: true` in the registry.** It belongs in the config, where the checker
  compares it with the rules.
- **Resuming a saved run straight from storage (`JSON.parse(row) as State`).** The game's
  `parseState`/`migrateState` decide; an unreadable run is dropped alone.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/host-architecture.md](references/host-architecture.md) | The seam, the files and their homes, one move end to end, the composition, the board host and tap-then-tap, the Game screen and Back, multi-package and React Navigation notes, every checker rule | Workflow steps 1, 2 and 4 |
| [references/session-flow.md](references/session-flow.md) | Opening and resuming runs, when a run is written, undo, hints, the rescue, the run end, stars and bests, counters, play time, pause on iOS and Android, stranded losses, save failures, debug controls, device evidence | Step 6, and before changing the controller |
| [references/assembling-a-game.md](references/assembling-a-game.md) | The binding, the registry, options against rules, save policy, gameFacing, the run repository on SQLite, catalog keys, the tally test game | Steps 3 and 5 |
| `templates/src/services/game-host/` | The seam (`game-host.ts`, `hosted-game.ts`, `host-runs.ts`), the controller, its persist step (`session-persist.ts`) and extras, the view, opening runs, the tutorial script, the run summary and counters, the play clock, the stranded-loss and Back policy, the board host and its pure model, the hosts context and `useGameSession`, each with its test | Step 2 (copy verbatim) |
| `templates/src/stores/game-session/` | The run's types, its pure reducer (`game-session-transitions.ts`), the per-run store (persist before publish) and the saved-run codec, with tests | Step 2 |
| `templates/src/data/game-runs/` | `GameRunsRepository` (the port) and its in-memory fake with its test | Step 2 |
| `templates/src/core/game-results/` | `RunRef` and `runKeyOf`, with tests | Step 2 |
| `templates/src/core/game/` | Synced copies (never edit here): game-rules-engine's game contract kit, and level-generation-and-solvers' `level-kit/star-rating.ts` (the one `starsFor`) and `level-kit/daily-start.ts` (the one daily seed and difficulty), with their tests | Step 2, only when the app lacks them |
| `templates/src/hooks/` | `use-pause-on-background.ts`: pauses a playing run when the app or the screen goes away, with its test | Step 2 |
| `templates/test/games/` | The tally test game (with its tutorial), its hosted form, run helpers and host test dependencies | Step 2 |
| `examples/app-wiring/` | The registry, the per-game config, a game's binding and tutorial, the games root and its result cue table | Steps 4 and 5 |
| `examples/game-screen/` | The Game screen's model hook (with the leaving flag), its route test over Expo Router's in-memory router (Back, Pause -> Home, pending loss, stack reset), the view and the thin route | Step 6 |
| `examples/sqlite-game-runs/` | The SQLite repository (practice rows for replayed dailies, the `extendRunEnd` hook inside the run-end transaction), its migration and its `node:sqlite` test | Step 3 |
| `scripts/check-game-host.mjs` | The checker (rules in references/host-architecture.md, `--help` lists them) | Steps 1 and 8 |
| `scripts/lib/` | `host-layout.mjs`, `host-static.mjs`, `host-probes.mjs`, `zustand-stand-in.mjs` (self-tests only), and the synced `app-modules.mjs` and `source-scan.mjs` | When changing the checker |
| `scripts/selftest.mjs` | Proves the checker: the templates and examples pass, every planted bug fails under its rule | After changing a checker, template or example |
| `scripts/check-lib.mjs` | Shared script library (synced; do not edit here) | Never by hand |
| `assets/shared.json` | The shared files this skill copies in | When adding a shared file |
| `tests/bases/app/` | The fixture app: one small game, the architecture contract, synced `result.ts` and `daily-seed.ts` | When adding a fixture |
| `tests/fixtures/check-game-host/` | `good/`, one `bad-*` case per rule, `pass-*` and `error-*` cases (overlay format) | When adding a rule |

## Related skills

- `game-rules-engine` - the game module, its kit and its pure rules.
- `level-generation-and-solvers` - levels, packs, par and the daily level a run opens.
- `realtime-game-loop` - save points and the loop of a real-time game.
- `skia-canvas-rendering`, `canvas-gestures-and-hit-testing` - the game's `Surface` and its intents.
- `state-management-zustand` - stores, persist before publish, the undoable session pattern.
- `persistence-and-migrations` - the SQL driver, repositories and the migration list.
- `architecture-and-boundaries` - zones, `gameFacing`, the composition root.
- `app-startup-and-bootstrap` - the root provider order the games root joins.
- `navigation-and-routing` - the Game route, guarded Back, `dismissTo`.
- `audio-and-haptics-feedback` - the win and lose feedback.
- `admob-ads-and-consent`, `in-app-purchases` - rescue and hint offers, paying first.
- `dates-streaks-and-statistics` - streaks and statistics from recorded runs.
- `debug-menu-and-test-hooks`, `e2e-maestro` - the debug controls and device flows.
