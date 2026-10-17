# Session flow

What happens to one run from opening to its result, and why each step is ordered the way it is.

## Contents

- Opening a run, and beginning it
- A run left behind (abandoned runs)
- Resuming a run
- Relaunch: Home's Continue and `shouldResumeOnLaunch`
- When the run is written
- Undo
- Hints
- The rescue
- The run end
- Stars, par and bests
- Daily runs, streaks and statistics
- Counters
- Play time
- Pause, the background and full-screen ads (iOS and Android)
- Back
- Never strand a finished run
- Save failures
- The tutorial run
- Real-time games and save points
- Test-build shortcuts
- What the tests prove
- Device evidence

## Opening a run, and beginning it

`host.openSession({ start: 'new', ref })` asks `startFor`: a level takes its table entry's seed and
difficulty; the daily takes `dailyStart(levels, date)` (level-generation-and-solvers'
`level-kit/daily-start.ts`, synced here: seeded-determinism-and-golden-vectors' `dailySeed(date,
salt)`, always passed through `seedRng` by the game, at the game's daily difficulty); an endless run
takes a fresh uint32 seed from the clock (or the test build's `seedOverride`) and the endless
difficulty (100, never won). A game without levels has nothing to open (`null`). `{ kind:
'tutorial' }` opens the game's tutorial (below). Each run is stamped with `startedOn` (the local day
it began): its result counts for that day even when it ends after midnight
(dates-streaks-and-statistics).

**Opening writes nothing.** `openSession` only builds the run and its controller. `useGameSession`
calls it in a `useState` initializer, which React may run twice (StrictMode, a render it repeats or
discards under concurrency), so it must not write. The one exception is idempotent: resuming a saved
run the game's parsers cannot read drops that row (`clearRun`), and a second render finds nothing more
to drop (boot validation in `createGameHost` usually dropped it already). The run starts when its handle **begins**
(`handle.begin()`, from `useGameSession`'s effect; later calls do nothing):

- a new run is written with `shouldResumeOnLaunch: true` (after a kill Home offers to continue it),
  once the game's previous saved run is settled (next section);
- a reopened loss whose rescue is no longer on offer is recorded;
- the run becomes the host's active run (the debug controls act on it; a tutorial never does).

A failed first write shows as `view.saveFailure`; the next write tries again.

## A run left behind (abandoned runs)

Back on a pending loss finishes it, but a crash, a kill or a route reset can still leave a decided
run in storage: a loss whose rescue was on offer, or a win whose record failed. A new run of the same
game must not overwrite it unrecorded, or that loss never reaches results, statistics and streaks.
So before a new run's first write the controller **settles** the previous run
(`settlePrevious`, `settleAbandoned` in `host-runs.ts`): the saved run is read and validated; if it
restores decided, it is recorded (a pending rescue counts as declined) in the usual one transaction.
If that record fails, nothing is written: the old run stays on disk, the view shows `saveFailure`,
and every later write retries the settle first. A live (undecided) saved run of another level is
simply replaced; starting a new level abandons it without counting a loss.

## Resuming a run

`{ start: 'resume' }` reads the saved run and calls `resumeSession`:

1. `restoreRun` parses the snapshot with the game's `parseState` (same `stateVersion`) or
   `migrateState` (an older one). `null` drops the run: the host clears that one row and logs it;
   results and statistics stay. The SQLite repository reads a row of corrupt JSON as "no saved run"
   (logged), so the host clears it too.
2. With the same version, the log is parsed (`parseMove`) and replayed from `create(seed,
   difficulty)`. If the replay reproduces the snapshot exactly (JSON-equal), the undo history is
   rebuilt; if not (a determinism bug, or rules changed without a version bump), the snapshot wins,
   the history is dropped, the log is marked partial (counters then record 0) and the mismatch is
   logged. A save-points (real-time) game is never replayed: its snapshot is the truth.
3. A run that was still being played comes back **paused**: nothing moves until the player resumes.
   A pending loss comes back lost, with its rescue still open.

`createGameHost` runs the same validation at boot, so a damaged run never reaches Home's Continue.

## Relaunch: Home's Continue and `shouldResumeOnLaunch`

One meaning each. **Home offers Continue for every saved run** (`host.savedRun() !== null`): that
is the library default, and the kill test expects it. **`shouldResumeOnLaunch`** says whether an app
that opens the run straight on launch (opt-in auto-resume) may do so: true while the player was in
the run, false after Pause -> Home (`leave`). An app that never auto-resumes ignores it.

An app that does auto-resume adds the **crash guard**, so a state that crashes the board cannot
crash-loop the app: the Game route's error boundary (expo-router's per-route `ErrorBoundary` export,
error-handling-typed-results) calls `useGameHost(gameId).leaveSavedRun()`, which rewrites the saved
run with `shouldResumeOnLaunch: false`; the next launch lands on Home, where Continue is still
offered.

## When the run is written

| Change | after-every-move game | save-points game (real time) |
|---|---|---|
| begin (a new run) | written, after the previous run is settled | same |
| move, undo, rescue, hint, staged example | written | not written |
| save point (`onSavePoint`, `sync-state`) | written | written |
| pause | written | written |
| decided, rescue pending | written (the pending loss) | written |
| decided, final | recorded (`recordRunEnd`, one transaction) | recorded |
| resume, play time | rides on the next write | rides on the next write |
| leave (Pause -> Home) | written with `shouldResumeOnLaunch: false` | same |
| tutorial, any change | nothing (memory only) | nothing |

## Undo

Unlimited, limited per level (`undoCount < perLevel`) or none, from the game's rules. Undo steps back
over moves only, only while playing: never out of a loss (the rescue is the way back, and it may be
paid for) and never across a rescue (the past is cleared when a rescue is applied).

## Hints

A game with `hints: { kind: 'solver', suggest }` offers hints. `view.isHintAvailable` is true while
the run is live and `suggest(state)` has a move: offer the hint (and take its price) only then, so a
paid hint is never wasted on a position without one. `suggest` runs once per changed view; a solver
too slow for that belongs in a precomputed hint table. The screen pays first (a free daily
allowance, a rewarded ad, Premium), then sends `hint`; the controller holds the solver's move for the
current `eventSeq` (the board outlines it) and counts it (`use-hint`, written). A hint arrives while
paused too (its rewarded ad paused the run) and shows on Resume. The next move clears it.
`freeHintsPerDay` is the app's option, 0 for a game without hints.

## The rescue

`continueRun: { kind: 'once', apply }` turns any way of losing back into play, once per run. It is
offered only when the app's options allow it (`isContinueAllowed`; with `false` the rules the
reducer sees have no rescue at all). While it is offered, the loss is **pending**: written as the run
(a kill keeps the offer), not recorded. The player continues (`continue`, after payment) or declines
(`finish`: Try again, Home, Back); declining records the loss once. The example model sends `pause`
right after `continue`: a rescued run restarts from Pause on both platforms, so the player gets their
bearings after the ad and a real-time loop never restarts under their thumb.

## The run end

A decided run with no rescue pending is recorded inside the persist step (`session-persist.ts`),
before the store publishes:

1. `bestScore(gameId, ref)` reads the best before this run; for a daily, `hasRunEnd(gameId, ref)`
   says whether that date already has a result (then the run is practice; a tutorial always is).
2. `summarizeRun` computes the result: won or lost, score (the outcome's for a win, the hud's
   otherwise), moves, play time, stars, par, new best, practice, best after, next level.
3. `recordRunEnd(runEndOf(...))`: ONE transaction with the result row (a won level keeps its best
   stars and score), the best, the statistics and counters, and the saved run cleared. A practice
   end writes only its row (marked practice) and clears the run.
4. Only when that returns ok: the summary goes into the extras, the deciding change plays the win or
   lose feedback (audio-and-haptics-feedback's `playCue` with the games root's cue table), then the
   store publishes and the result shows.

A failed write publishes nothing: the board still shows the previous state, the view shows
`saveFailure`, and the same tap tries again.

## Stars, par and bests

`starsFor(rule, run)` (`src/core/game/level-kit/star-rating.ts`, level-generation-and-solvers'
one star formula; the host carries a synced copy and never its own): par levels give 3 stars at or under par, 2 up to par + 2
(`PAR_SLACK_FOR_TWO_STARS`), 1 for finishing; score levels give 3 and 2 at `thresholds[2]` and
`thresholds[1]`. Losses, dailies and endless runs give 0. A score-rated level has no par (the result
shows the score and the best). A new best counts for wins, and for endless runs win or not (an
endless run only ends lost); practice (a replayed daily, a tutorial) never counts.

## Daily runs, streaks and statistics

The daily follows dates-streaks-and-statistics' daily-challenge profile:

- **The first finished attempt of a date is the day's result, won or lost.** A later run of the same
  daily is practice: `summary.isPractice` is true, it never shows "New best!", and its
  `RunEndRecord.isPractice` tells the repository to insert the row (marked practice) and clear the
  run without raising the best or touching statistics, counters or streaks. Proven by the
  `daily-practice` probe and the SQLite example's test.
- **The day is `startedOn`**, the local day the run began: a daily finished after midnight still
  counts for the day it was opened, and `RunEndRecord.day` carries it.
- **Streaks are derived on read by default**: the first non-practice row per day in `game_run_ends`
  (`SELECT DISTINCT day ... WHERE is_practice = 0`) feeds dates-streaks-and-statistics' streak
  functions, so there is nothing to keep in step. An app that stores its streak instead folds
  `recordCompletion` (day = `end.day`, skipped for practice) into the same transaction.
- **Other app sections that change with a run end** (a stored streak, the ad history, an
  achievements table) join the same transaction through the SQLite repository's `extendRunEnd`
  hook: a throw there rolls the whole run end back, so the result on screen and every section agree.

## Counters

`measureCounters` replays the kept log from `create(seed, difficulty)` and folds each counter
(`sum` or `max`) over every move's events, the rescue's included. Undone moves left the log, so they
never count; a run resumed after a kill measures exactly what the player kept; a partial log
(restored without history, staged by a test build, or synced from a real-time loop) measures 0.

The replay is not wrapped in `attempt` on purpose: every move in a full log was applied once by the
same pure `applyMove` (live play), or the log was proven to reproduce the snapshot when it was
restored (otherwise it is partial and never replayed). A replay that throws therefore means an
impure rule, which game-rules-engine's determinism tests exist to catch. A real-time game keeps the
statistics it needs in its own state (the snapshot) and its `hud` score.

## Play time

Each command and intent laps the play clock first: the time since the previous lap counts only if
the run was playing all that time, clamped to 0..300,000 ms per step (a clock set back adds 0; a
phone asleep on the result adds at most five minutes). The clock is the injected `ClockPort.nowMs`,
never `Date.now`.

## Pause, the background and full-screen ads (iOS and Android)

`usePauseOnBackground` pauses on the transition to away. iOS reports `inactive` for the app
switcher, Control Center and an incoming call, then `background`; Android reports only `background`
(verified on react-native 0.86.3's `AppState`). Both pause. Losing focus (a modal route over the
Game screen) pauses too. The pause is written with the play time, and coming back shows Pause.

**Full-screen ads differ by platform.** On iOS a Google full-screen ad (interstitial or rewarded)
covers the app but leaves `AppState` `active`, so `usePauseOnBackground` never fires: the run would
keep counting play time and a real-time loop would keep running. On Android the ad is its own
activity, so `AppState` may move to `background` and the run pauses that way (expected from the
activity lifecycle; not verified on a device for this skill). The Game screen therefore joins
admob-ads-and-consent's `runFullscreenAd` lifecycle on both platforms: the model hook subscribes to
the app's one `FullscreenAdGate` (`useServices().fullscreenAd`) and sends `pause` when it starts
showing (`usePauseOnFullscreenAd` in `examples/game-screen/use-game-model.ts`). **Decided once:
after a full-screen ad the player sees Pause on both platforms** and resumes when ready, exactly as
after the background. A hint paid for with the ad arrives while paused and shows on Resume; a
rescue paid for with the ad lands paused (`continue`, then `pause`). A real-time board also stops its
loop while the gate shows (realtime-game-loop's `isInterrupted`), which takes a save point.

## Back

`backCommandOf(view)` (`run-end-policy.ts`) is what Back does instead of leaving, and
`usePreventRemove(backCommandOf(view) !== null, ...)` blocks removal while it is not null:

| The run | Back sends | Why |
|---|---|---|
| playing | `pause` | Back in play opens Pause |
| paused | `resume` | Back inside Pause closes it |
| lost, rescue offered, not recorded | `finish` | the loss is recorded and the result shows; a second Back leaves |
| recorded (summary set), or nothing open | nothing: Back leaves | nothing live is left behind |

Only Pause -> Home leaves a live run (`leave`: written, `shouldResumeOnLaunch: false`). `leave`
changes no status (the run stays paused) and React has not re-rendered when Home calls
`router.dismissTo('/')`, so the guard is still on and would turn that removal into `resume`. The model
therefore sets a leaving flag (`useRef`) before sending `leave`; the `usePreventRemove` callback
sees it and lets the removal through with `navigation.dispatch(data.action)` instead of sending
Back's command. The same flag lets Home leave a pending loss in one tap (Home records it first).
`examples/game-screen/game-route.test.tsx` proves every row of the table and both Home paths. The
route is `guarded` with `"gesture": "off"` in navigation-and-routing's contract, so the iOS swipe
never starts on the board.

## Never strand a finished run

A pending loss waits for the player. If nobody can rescue it (the offer is `'hidden'`: ads off,
offline, no consent, no rewarded ad that can come, no Premium), it would wait forever: the result
never shows and the run is never counted. The model hook sends `finish` once per `eventSeq` when
`isLossStranded(view, offer)`, also when a shown offer becomes hidden and when a pending loss is
reopened. A rewarded ad that is still loading is `'loading'` (the button shows busy), never
`'hidden'`. A reopened loss whose rescue the app has since switched off is recorded when its run
begins.

## Save failures

The repository returns `storage-full`, `storage-busy` or `storage-unavailable` (the raw error is in
the error log). Nothing changes on screen; `view.saveFailure` drives ui-states-and-feedback's retry
message. The next successful write clears it. A new run whose first write (or whose settle of the
previous run) failed shows it the same way, and its next write tries again.

## The tutorial run

A game may ship a scripted tutorial (`HostedGame.tutorial`, pure data in
`src/games/<id>/tutorial/<id>-tutorial.ts`): a `start()` state and steps, each with the catalog key
of its coaching sentence and the move it expects (`{ kind: 'move', move }` or `{ kind: 'any-move' }`).
`{ start: 'new', ref: { kind: 'tutorial' } }` opens it:

- It starts from `tutorial.start()` (seed 0, difficulty 0), with no rescue.
- It plays **beside** the saved run, in memory only: its controller's repository writes nothing, so
  its moves, pause, leave and end never replace, record or clear the game's saved run, and it counts
  in no statistics. It is never the active run of the debug controls.
- Step N (`moveCount` N) plays only its expected move (`isTutorialMoveAccepted`, moves compared by
  value); a tap the script does not expect does nothing. Undo steps back one move, so the script
  steps back with it. After the last step the run plays freely.
- `view.tutorialStep` gives the screen the current step (`messageId`, `index`, `count`), null after
  the script; the screen shows the sentence and its own Skip (it simply leaves).
- The checker replays every step from `start()` through the game's own engine
  (`tutorial-legal`): an expected move `listMoves` does not offer at that point, or a step after the
  run is decided, fails.

Where the tutorial is routed (a first-launch screen, a "How to play" button) and its pages are the
app's product decisions (navigation-and-routing, i18n-strings-and-catalogs).

## Real-time games and save points

Turn-based games save after every move (`savePolicy: { kind: 'after-every-move' }`). A real-time
game (realtime-game-loop) declares `{ kind: 'save-points', points }`, and its board saves through
the host, never around it:

1. The board's real-time host stops the loop at a save point (pause, background, blur, a full-screen
   ad, a wave end between frames), copies the sim (`sim.get()`), and its `onSavePoint` turns the copy
   into JSON with `realtime.snapshot(copy)`.
2. The board calls `GameSurfaceProps.onSavePoint(state, inputLog)`, which the board host wires to the
   controller's `savePoint`. The controller dispatches `{ type: 'sync-state', state, moves }` through
   the same store: the state replaces the run's state, the input log becomes the run's log (kept for
   a debug replay, never replayed by the host), and the persist step writes it whatever the save
   policy. Moves never write a save-points game; only save points and pause do.
3. **The run's end is a save point too:** when a batch holds the end (death, time up), the board
   takes the final snapshot and calls `onSavePoint` with it. The state decides the run, so the
   persist step records it once (one transaction) and plays the feedback; the view's status becomes
   `won` or `lost`, which the board reads as `isEnded` (the loop stops with no further save point)
   and the screen shows the result.
4. A real-time run that comes back from storage is restored from its snapshot alone and resumes
   paused; the board rebuilds its sim with `realtime.createSim(state)`.
5. A real-time game stays paused after a full-screen ad and after the background, like every run.

A direct `writeRun` from the screen would skip the store (the board would show a state that is not
the run's), the save policy and the run-end transaction; `save-point-write` proves the host path.

## Test-build shortcuts

`host.debugControls().endActiveRun('win' | 'lose')` stages the game's `testing.examples` win or lose
state through the store (`stage-state`), so the same persist step records the end (or keeps a
rescuable loss pending). The log is then partial (counters 0). Hand `debugControls()` only to the
debug layer (debug-menu-and-test-hooks' test-only entry), never to store builds; e2e-maestro's debug
link drives it.

## What the tests prove

| Test | Proves |
|---|---|
| `game-session-transitions.test.ts` | moves only while playing, undo rules, one rescue, hints while live and play time only while playing, save-point syncs, a property: no input mutation and determinism |
| `game-session-store.test.ts` | persist before publish, a failed write publishes nothing, a refused action writes nothing |
| `saved-run.test.ts` | the written form, resume paused, pending loss kept, drops, replay mismatch, a save-points run restored from its snapshot |
| `session-persist.test.ts` | one run-end transaction with its summary, a refused record writes nothing, settle before every write |
| `session-controller.test.ts` | save before show, intents through the game, one run-end write, feedback once, pending loss, rescue once, hints (also paused), play time, leave, save failures (also the first write), begin once, a blocked settle writes nothing, save points, the tutorial step gate, debug end, reopened loss |
| `host-runs.test.ts`, `game-host.test.ts` | facts, boot validation, resume paused, opening is pure and begin writes, an abandoned loss recorded first and never overwritten when that fails, the tutorial beside the saved run, the crash guard, missing runs, rescue off, debug controls |
| `tutorial-script.test.ts`, `session-view-of.test.ts`, `run-end-policy.test.ts` | the step gate and coach, hint availability, stranded losses, Back per state |
| `use-game-session.test.tsx` | opening, commands, the next run, one write under StrictMode and the active run being the one on screen |
| `create-board-host.test.tsx`, `board-host-model.test.ts` | the board gets the saved state, taps go through the game, tap-then-tap selection, hint and pause on the board |
| `use-pause-on-background.test.tsx` | pause on background (iOS and Android states) and blur, never by the opening state |

## Device evidence

Run on devices you name, never "the booted simulator": create `<project>-games` simulators and
emulators for this (ios-simulator-build, android-emulator-build) and pass their ids.

- **Kill test:** start a level, make a move, kill the app during the animation
  (`xcrun simctl terminate <udid> <bundle-id>` / `adb -s <serial> shell am force-stop <package>`),
  relaunch: Home offers Continue; continuing lands paused in the same position with undo working.
- **A full level to its result:** play to a win; the stars on the result match the level's rule;
  relaunch: the level shows its stars (the end was on disk before the result).
- **Background:** start a run, send the app to the background (iOS home gesture; Android
  `adb -s <serial> shell input keyevent KEYCODE_HOME`), return: Pause shows.
- **Back:** during play, swipe back on iOS and press Back (or use the predictive back gesture) on
  Android: Pause opens, the run stays; Back again resumes. On a loss with the rescue on offer, Back
  shows the result.
- **Full-screen ad** (an `ADS_MODE=test` build, admob-ads-and-consent's smoke run): watch a rewarded
  hint ad to its reward on iOS and on Android; after closing it, Pause shows on both and the hint is
  outlined on Resume. Record the Android `AppState` sequence you saw (it is not verified here).

e2e-maestro turns these into flows (with `--device <id>`).
