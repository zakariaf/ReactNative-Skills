# Host architecture

How a typed game becomes a playable screen without any screen, store or route knowing its types.
Verified on 2026-10-14 against Expo SDK 57 (expo-router 57.0.24, React 19.2.3, zustand 5.0.15,
TypeScript 6.0.3) in the reference app; re-verify with `npm ls expo-router zustand typescript react`.

## Contents

- Why one seam
- The files and their homes
- One move, end to end
- The composition
- The board host and tap-then-tap
- The Game screen and Back
- Optional parts: the tutorial and real-time boards
- When multi-package
- With React Navigation instead of Expo Router
- The checker's rules

## Why one seam

A game module is `GameModule<TState, TMove, TEvent, TIntent>` (game-rules-engine). The app hosts
several games, but TypeScript has no existential types: a list or a context of "a module of some
type" needs `GameModule<unknown, ...>`, and under `strictFunctionTypes` a module whose
`intentToMove` takes `CanvasIntent` is not assignable to one taking `GameIntent` (parameters are
contravariant). The only ways out are a cast, which silences exactly the errors the compiler is
there for, or a closure: `createGameHost(game, deps)` is generic, keeps the typed module inside,
and returns a `GameHost` whose surface is plain data, callbacks and components.

```
src/games/<id>/<id>-hosted.ts   HostedGame<S, M, E, I>  ─┐
                                                       createGameHost(game, deps)   (the seam)
src/games/game-registry.ts      (deps) => createGameHost(<ID>_HOSTED, ...)  per game
                                                          │
GameHost { id, nameId, counters, packs, hasDaily, ..., savedRun(), openSession(), leaveSavedRun(),
           debugControls() }
                                                          │ openSession()  (pure: builds only)
OpenedSession { handle: SessionHandle (begin, getView, subscribe, send), BoardHost }
                                                          │ handle.begin()  (useGameSession's effect)
Game screen: useGameSession(gameId, open) -> view (SessionView), send(SessionCommand), <BoardHost/>
```

## The files and their homes

| File | Zone | What it holds |
|---|---|---|
| `src/core/game/*` | core | game-rules-engine's contract kit (byte-identical copy in `templates/`) |
| `src/core/game-results/run-ref.ts` | core | `RunRef` (level, daily, endless) and `runKeyOf` |
| `src/core/game/level-kit/star-rating.ts` | core | `starsFor`, `isScoreRule`: the one star formula, owned by level-generation-and-solvers (synced copy) |
| `src/stores/game-session/game-session-types.ts` | stores | `GameSession`, `SessionAction`, `SessionRules`, `SessionStart` |
| `src/stores/game-session/game-session-transitions.ts` | stores | `gameSessionReducer(rules, session, action)`, `canUndo`, `isRescuePending`, `startGameSession` |
| `src/stores/game-session/game-session-store.ts` | stores | `createGameSessionStore({ rules, initial, persist })`, `useGameSessionStore(store, selector)` |
| `src/stores/game-session/saved-run.ts` | stores | `toSavedRun`, `restoreRun` (snapshot wins, replay rebuilds undo, resume paused) |
| `src/data/game-runs/game-runs-repository.ts` | data | the port: `savedRun`, `writeRun`, `clearRun`, `bestScore`, `hasRunEnd`, `recordRunEnd` (`isPractice` on the record) |
| `src/data/game-runs/fake-game-runs-repository.ts` | data | the in-memory fake (tests and the checker's probes) |
| `src/data/game-runs/sqlite-game-runs-repository.ts` | data | the app's adapter (from `examples/sqlite-game-runs/`) |
| `src/services/game-host/hosted-game.ts` | services | `HostedGame` = `GameModule & { Surface, tutorial? }`, `GameSurfaceProps` (with `onSavePoint`), `TutorialSpec`: the seam games face |
| `src/services/game-host/game-host.ts` | services | `createGameHost`, `GameHost`, `GameHostDeps`, `GameHostOptions`, `BoardHostFactory`; the active run, `leaveSavedRun` |
| `src/services/game-host/host-runs.ts` | services | inside the seam: the validated saved run, a new run with its abandoned-run settle, the tutorial run, each run's controller deps |
| `src/services/game-host/session-controller.ts` | services | the typed controller: begin, commands, intents (with the tutorial's step gate), save points, hints, leaving, debug end |
| `src/services/game-host/session-persist.ts` | services | the persist step: write per the save policy, the one run-end transaction (`recordFinishedRun`), the result feedback |
| `src/services/game-host/tutorial-script.ts` | services | `isTutorialMoveAccepted`, `tutorialCoachOf`, `isSameMove` |
| `src/services/game-host/session-extras.ts` | services | summary, hint and save failure held beside the store |
| `src/services/game-host/session-view.ts`, `session-view-of.ts` | services | `SessionView`, `SessionCommand`, `SessionHandle`; the view builder, `continueStateOf` |
| `src/services/game-host/open-session.ts` | services | `sessionRulesFor`, `startFor`, `newSession`, `resumeSession` |
| `src/services/game-host/run-summary.ts`, `measure-counters.ts`, `play-clock.ts` | services | the result, the run-end record, counters from the kept log, play time |
| `src/services/game-host/run-end-policy.ts` | services | `isLossStranded`, `RescueOffer`, `backCommandOf` (what Back sends) |
| `src/services/game-host/board-host-model.ts`, `create-board-host.tsx` | services | the selection model; the board host component factory |
| `src/services/game-host/game-host-context.tsx`, `use-game-session.ts` | services | `GameHostsProvider`, `useGameHost(id)`, `useGameHosts()`; `useGameSession` |
| `src/hooks/use-pause-on-background.ts` | hooks | pause on background or blur (it reads `expo-router`, so it lives with the shared hooks) |
| `src/games/game-registry.ts` | games (shelf) | one factory per game, `createGameHosts(deps)` |
| `src/config/game-host-config.ts` | config | `GAME_HOST_CONFIG`: per-game `isContinueAllowed`, `freeHintsPerDay` |
| `src/games/<id>/tutorial/<id>-tutorial.ts` | games | the game's optional tutorial (pure data; `examples/app-wiring/lights-out-tutorial.ts`) |
| `src/features/root-navigator/games-root.tsx`, `game-feedback.ts` | features | the games root and its result cue table (`playCue`) |
| `test/games/*` | test | the tally game (with its tutorial), its hosted form, run helpers, host test deps |

Why the reducer file is not called `*-reducer.ts`: its reducer is bound to the game's rules
(`gameSessionReducer(rules, session, action)`); state-management-zustand's `check-reducers` runs
two-argument reducers against a cases table, so this one is pinned by its own test and by this
skill's probes instead. The store still publishes only what `...Reducer(` produced, and its factory
file declares `useGameSessionStore(store, selector)`, so `check-stores` sees a per-session store.

## One move, end to end

1. A finger taps the board. The game's Surface (canvas-gestures-and-hit-testing) calls
   `onIntent({ kind: 'tap', target, selected: null })`.
2. The board host routes it (`routeIntent`): a tap in a select region only selects; otherwise the
   selection fills `selected` and the intent goes to `controller.sendIntent`.
3. The controller laps the play clock, asks `game.input.intentToMove(state, intent)`; `null` ends
   here (and, in a tutorial, a move its current step does not expect). A move is dispatched as
   `{ type: 'apply-move', move }`.
4. The store reduces (`gameSessionReducer`). A refused action returns the same session: no write,
   no render.
5. The persist step (`session-persist.ts`) runs before `set()`: the previous saved run is settled
   once (a new run's first write), a live run is written (`writeRun`) per the save policy, a decided
   run with no rescue pending is recorded (`recordRunEnd`, one transaction) and its summary is put in
   the extras; the deciding move plays the feedback.
6. On success the store publishes. The board host re-renders the Surface with the new state and
   `lastEvents`; the screen's `useSyncExternalStore` sees a new `SessionView` (summary included).
7. On a failed write nothing is published: the extras get `saveFailure` and notify, the screen
   offers a retry, and the board still shows the state on disk.

## The composition

`GamesRoot` (`examples/app-wiring/games-root.tsx`) creates the hosts once, in a `useState`
initializer, from the services (`clock`, `errorLog`, audio and haptics for the feedback) and the data
layer (`gameRuns` from `useAppData()`), and renders `GameHostsProvider`. It mounts inside the
navigation theme in `root-stack.tsx`, in app-startup-and-bootstrap's provider order, so every route
(Home's Continue button, a game list, the Game screen) reads the same hosts. Creating a host reads
and validates the game's saved run, so:

- never at import time (`host-at-import`): storage is not open, and Fast Refresh would run it twice;
- never in a render (`host-in-render`): each render would re-validate and replace the hosts (the
  React Compiler may memoize a plain call, but that is not a guarantee);
- before any screen asks `host.savedRun()`: the provider sits above the routes.

Prove the providers with one render test through the real root (the app's `test/test-app.tsx`
wiring), not a wrapper written for one screen: a provider the root forgets fails there and nowhere
else.

## The board host and tap-then-tap

`createBoardHost({ game, controller })` returns one component per opened run. It reads the session
with `useGameSessionStore(store, (state) => state.session)` (the same object until a change), the hint
with `useSyncExternalStore(handle.subscribe, controller.hintedMove)`, keeps `BoardSelection` in
`useState`, and renders `game.Surface` with `state`, `lastEvents`, `eventSeq`, `isInputEnabled`
(playing only), `isEnded`, `selected`, `hintedMove`, `onIntent` and `onSavePoint`. The selection
belongs to the `eventSeq` it was made at (`selectedAt`), so any applied, undone or continued move,
and the run's end, clear it without an effect. A drag clears it too. The Surface announces selection changes to VoiceOver and
TalkBack itself (accessibility-as-code); the host passes the fact.

## The Game screen and Back

The route (`src/app/game/[gameId].tsx`) is thin: it parses its params with a valibot parser
(navigation-and-routing's `paramParsers`) and renders `GameScreen`. The model hook
(`examples/game-screen/use-game-model.ts`) is the only code that reads the host, navigation and the
monetization layer:

- `useGameSession(gameId, open)` builds the run once per screen (a `useState` initializer, pure)
  and begins it in an effect, so StrictMode's repeated render writes nothing and the host's active
  run is the one on screen.
- `usePauseOnBackground(status, pause)` pauses on the transition to away: `AppState` leaving
  `active` (iOS `inactive` and `background`, Android `background`) or the screen losing focus
  (`useIsFocused` from `expo-router`).
- `usePauseOnFullscreenAd(gate, pause)` pauses when admob-ads-and-consent's `FullscreenAdGate`
  starts showing (iOS keeps `AppState` `active` under a Google full-screen ad); Pause shows
  afterwards on both platforms (session-flow.md).
- `usePreventRemove(back !== null, ({ data }) => ...)` from `expo-router/react-navigation`, with
  `back = backCommandOf(view)`, catches every Back (header, iOS swipe, Android back button and
  predictive back gesture) while the run is live and unrecorded: pause in play, resume in Pause,
  finish a pending loss. List the route in `guarded` with its `hook` (the model hook's path) and
  `"gesture": "off"` in `contracts/navigation.json`, and set `gestureEnabled: false` and
  `fullScreenGestureEnabled: false` in its screen options.
- Home from Pause sets a leaving flag (`useRef`), sends `leave` (the run stays saved and a relaunch
  lands on Home; a pending loss is recorded) and calls `router.dismissTo('/')`, never `push`. `leave`
  changes no status and React has not re-rendered yet, so the guard is still on: its callback sees
  the flag and lets that removal through with `navigation.dispatch(data.action)` (`useNavigation`
  from `expo-router`); without the flag, Home would send `resume` and the run would start again.
- `examples/game-screen/use-game-model.test.tsx` proves it through Expo Router's in-memory router
  (`renderRouterWithProviders`, a stand-in Home and Game route): Back pauses in play and resumes in
  Pause, Pause -> Home leaves in one tap, Home on a pending loss records it and leaves, Back
  finishes a pending loss and leaves on the next Back, a recorded run's Back leaves, and a stack
  reset on a live run pauses instead. Copy it beside the model and add the perk cases (a hint or
  continue is sent only after `pay`, a stranded loss is finished once, a full-screen ad pauses).

## Optional parts: the tutorial and real-time boards

Both enter through the same seam, so no screen learns a game type:

- **The tutorial** is `HostedGame.tutorial` (game-rules-engine's `GameModule` leaves it to the host:
  "the surface, sounds, a tutorial" by intersection). `host-runs.ts` opens `{ kind: 'tutorial' }`
  from `tutorial.start()` with a repository that writes nothing, and the controller gates each move
  with `isTutorialMoveAccepted`; the view carries `tutorialStep`. The app decides where it is routed.
- **A real-time board** (realtime-game-loop's `RealtimeCanvasHost` inside the game's `Surface`)
  receives `onSavePoint` with the other Surface props and calls it with `realtime.snapshot(copy)` and
  its input log; the board host passes `controller.savePoint`, which goes through the store and the
  persist step like a move. It reads `isEnded` (the run is decided) and `isInputEnabled` (false
  when paused or decided): the real-time host's `isEnded` and `isPaused = !isInputEnabled &&
  !isEnded`. Its `onAutoPause` has nothing to do: the Game screen already pauses the run on
  background, blur and full-screen ads, and the board sees it through `isInputEnabled`.

session-flow.md ("The tutorial run", "Real-time games and save points") has the rules.

## When multi-package

Put the host in the app workspace (`apps/<app>/src/services/game-host/`); games may live in packages
(`packages/<game>`), each exporting its `<ID>_GAME`, with the binding (`<id>-hosted.ts`) in the app
because the Surface is app UI. Run the checker once per app with the app folder as the repo root and
pass `--games-dir` (or `gamesDir` in `rn-skills.config.json`) when games are elsewhere.

## With React Navigation instead of Expo Router

The host is navigation-free except `usePauseOnBackground`: import `useIsFocused` from
`@react-navigation/native` instead of `expo-router`, and `usePreventRemove` from the same package
(`backCommandOf` is the same).
Pass the Game screen's params through the static navigator's param list; everything else is the
same.

## The checker's rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-game-host.mjs [repo-root] [--game <id>] [--games-dir <dir>]
[--host-dir <dir>] [--no-run]`. "(run)" rules load the repo's own modules in Node (type stripping)
and drive them with `test/games/tally-game.ts` and the fake repository; they need the app's
dependencies installed (`npm ci`), else exit 2. `rn-skills.config.json` keys: `gamesDir`,
`gameHostDir`.

| Rule | Fails when |
|---|---|
| `host-file-missing`, `host-export-missing`, `host-test-missing` | a host file, one of its exports, or the test beside a runtime file is missing |
| `host-load` | a host or game module cannot run in Node (an enum, a runtime React Native import in a `.ts`) |
| `save-before-publish` (run) | the store publishes before persist, or publishes after a failed write |
| `moves-only-while-playing`, `undo-not-after-loss`, `continue-once` (run) | the reducer takes moves while paused or decided, undoes out of a loss, or rescues twice or without a loss |
| `saved-run-validated` (run) | restore ignores the game's parsers, lets the replay beat the snapshot, or resumes playing; or `createGameHost` keeps an unreadable saved run |
| `run-end-once` (run) | a win is written in more than one call, or shown before its end is on disk |
| `result-feedback` (run) | the win feedback plays before the end is on disk, or more than once; a rescuable loss plays its lose again when the rescue is declined |
| `daily-practice` (run) | a replayed daily (its date already has a result) becomes a new best, raises the best, or is not marked `isPractice` |
| `rescue-pending` (run) | a rescuable loss is recorded at once, or declining does not record it |
| `abandoned-run-recorded` (run) | a new run replaces a saved pending loss without recording it, or overwrites it when that record failed |
| `save-point-write` (run) | a save-points game writes per move, does not write a save point, or does not record a deciding save point once |
| `tutorial-beside-run` (run) | the tutorial writes or records anything, becomes the active run, or plays a move its step does not expect |
| `back-guard` (run) | `backCommandOf` does not pause in play, resume in Pause and finish a pending loss, or blocks Back on a recorded run |
| `intent-legality` (run and source) | a screen applies or dispatches a move, or the controller makes a move without `intentToMove` |
| `stars-from-table`, `counters-from-log` (run) | stars ignore the level rule; counters include undone moves |
| `save-failure-shown` (run) | a failed write is not shown as `saveFailure` |
| `debug-run-end` (run) | `debugControls().endActiveRun` does not record through the real write |
| `loss-not-stranded` (run) | `isLossStranded` is not exactly "pending loss and offer hidden" |
| `play-time` (run) | time counts while not playing, or a step is not clamped to 0..300,000 ms |
| `unsafe-cast` | a cast in the seam, the run store, the registry or a binding |
| `screens-type-erased` | routes, features, UI, stores or shared hooks import a game folder, `hosted-game`, `session-controller` or `game-module`, or name `HostedGame`/`GameModule`/`SessionController` |
| `host-not-created`, `host-at-import`, `host-not-provided` | no registry call to `createGameHost`; a host created at module level; no `<GameHostsProvider>` |
| `host-in-render` | in a `.tsx` or `use-*.ts` file, `createGameHost(s)(` inside a function but not the body of `useState(() =>` (or a `ref.current ??=`) |
| `continue-from-config` | a literal `isContinueAllowed:` outside the config |
| `game-screen-wiring` | the feature that calls `useGameSession` lacks `usePauseOnBackground`, `usePreventRemove`, `backCommandOf`, `<BoardHost`, `isLossStranded` or `type: 'finish'`, or the first argument of `usePreventRemove` neither calls `backCommandOf` nor names the variable assigned from it (SKIP before it exists) |
| `hosted-binding`, `game-registered` | the binding is not `{ ...<ID>_GAME, Surface[, tutorial] }` typed `HostedGame`; the registry does not host it |
| `tutorial-legal` (run) | the binding has a tutorial but `<id>/tutorial/<id>-tutorial.ts` is missing, or a step's move is not in `listMoves` at that point of the replay (or comes after the run is decided) |
| `config-rules` (run) | no options for a game, a rescue allowed without `continueRun: 'once'`, free hints without a solver |
| `save-policy` (run) | a game with `sim/` saves after every move, or a turn-based game only at save points |
| `game-facing-recorded` | `gameFacing` does not list `hosted-game.ts` (SKIP before `contracts/architecture.json` exists) |

**Limits of the source rules** (heuristics over text, never a parse): `host-in-render` looks only at
the 80 characters before the call, so `createGameHosts` wrapped in a helper the component body calls
is not seen, and a call inside a non-hook helper of a `.tsx` file is reported (move it into the
initializer). `game-screen-wiring` checks that the tokens exist in the feature folder and that the
guard's condition is `backCommandOf(...)` or a variable assigned from it in the same folder (a
condition computed in another hook, or a leaving flag that is never read, is not seen); the Game
screen's model test (`examples/game-screen/use-game-model.test.tsx`) proves the wiring. The run rules are the
strong ones: they execute the app's own modules.

NOT APPLICABLE: the app has no game and no host. The probes never read the device, the network or
the clock; the checker scans `src/` with the repo walk (installed skills and vendored folders holding
a `SKILL.md` are never read).
