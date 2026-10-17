// host-probes.mjs: the host's invariants proven by running the repo's own modules (the run store,
// the controller, the host and the policy) against the repo's tiny tally game (test/games/
// tally-game.ts) and its in-memory run repository, plus each game's options against its rules.
// Nothing here trusts a function name: a renamed helper that keeps the behaviour passes, a moved
// line that breaks it fails. Not an entry point.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { UsageError } from '../check-lib.mjs';
import { errorText, reasonOf } from './app-modules.mjs';

const ONE = { kind: 'add', amount: 1 };
const TWO = { kind: 'add', amount: 2 };
const tap = (col, regionId = 'board') => ({ kind: 'tap', target: { regionId, col, row: 0 }, selected: null });
const LEVEL_1 = { kind: 'level', level: 1 };

/** Loads the modules the probes need; a missing bare package means the repo is not installed. */
export async function loadHostModules(host, app, report) {
  const paths = {
    transitions: `${host.storeDir}/game-session-transitions.ts`,
    store: `${host.storeDir}/game-session-store.ts`,
    savedRun: `${host.storeDir}/saved-run.ts`,
    openSession: `${host.hostDir}/open-session.ts`,
    controller: `${host.hostDir}/session-controller.ts`,
    gameHost: `${host.hostDir}/game-host.ts`,
    policy: `${host.hostDir}/run-end-policy.ts`,
    tutorialScript: `${host.hostDir}/tutorial-script.ts`,
    playClock: `${host.hostDir}/play-clock.ts`,
    fakeRuns: `${host.dataDir}/fake-game-runs-repository.ts`,
    tally: `${host.testGamesDir}/tally-game.ts`,
  };
  const mods = {};
  for (const [key, rel] of Object.entries(paths)) {
    if (!existsSync(join(host.root, rel))) continue;
    try {
      mods[key] = await app.load(rel);
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find package '([^']+)'/.test(String(error.message))) {
        throw new UsageError(`${rel} imports a package that is not installed (${/Cannot find package '([^']+)'/.exec(String(error.message))[1]})`, 'Install the app\'s dependencies (npm ci) and rerun, or pass --no-run to check the source only.');
      }
      report.problem({ file: rel, line: 1, rule: 'host-load', message: `cannot run in Node: ${errorText(error)}`, fix: 'Keep the host\'s .ts files pure TypeScript with type-only React imports (the board host is the one .tsx); the probes run them headless.' });
    }
  }
  return mods;
}

/** Runs one probe; a failed assertion is a problem under its rule. */
function probe(report, { file, rule, name, fix }, run) {
  try {
    run();
  } catch (error) {
    report.problem({ file, line: 1, rule, message: `${name}: ${reasonOf(error)}`, fix });
  }
  return 1;
}

function tallyRules(mods) {
  const game = mods.tally.TALLY_GAME;
  const { create, applyMove, outcome } = game.engine;
  return { game, rules: { create, applyMove, outcome, undo: game.rules.undo, continueRun: game.rules.continueRun } };
}

function played(mods, rules, actions) {
  const { gameSessionReducer, startGameSession } = mods.transitions;
  const first = startGameSession(rules, { ref: LEVEL_1, seed: 1, difficulty: 1, startedOn: '2026-10-14' });
  return actions.reduce((session, action) => gameSessionReducer(rules, session, action), first);
}

const move = (amount) => ({ type: 'apply-move', move: amount === 1 ? ONE : TWO });

/** moves-only-while-playing, undo-not-after-loss, continue-once: the reducer's rules. */
function probeTransitions(host, mods, report) {
  if (!mods.transitions || !mods.tally) return 0;
  const { rules } = tallyRules(mods);
  const { gameSessionReducer } = mods.transitions;
  const file = `${host.storeDir}/game-session-transitions.ts`;
  let checked = probe(report, { file, rule: 'moves-only-while-playing', name: 'a paused or decided run ignores moves', fix: 'apply-move returns the same session unless status is playing.' }, () => {
    const paused = played(mods, rules, [{ type: 'pause' }]);
    const won = played(mods, rules, [move(2), move(2)]);
    assert.equal(gameSessionReducer(rules, paused, move(1)), paused, 'a paused run took a move');
    assert.equal(gameSessionReducer(rules, won, move(1)), won, 'a won run took a move');
  });
  checked += probe(report, { file, rule: 'undo-not-after-loss', name: 'undo never steps out of a loss', fix: 'canUndo is false unless the run is playing and the last log entry is a move (a loss is rescued only by the paid continue).' }, () => {
    const lost = played(mods, rules, [move(2), move(1), move(2)]);
    assert.equal(lost.status, 'lost');
    assert.equal(gameSessionReducer(rules, lost, { type: 'undo' }), lost, 'undo stepped out of a loss');
  });
  checked += probe(report, { file, rule: 'continue-once', name: 'one rescue per run, only after a loss, and undo cannot cross it', fix: 'use-continue applies continueRun once (continuesUsed 1, past cleared) and only while a loss is pending; a second loss is final.' }, () => {
    assert.equal(played(mods, rules, [{ type: 'use-continue' }]).continuesUsed, 0, 'a rescue was given without a loss');
    const rescued = played(mods, rules, [move(2), move(1), move(2), { type: 'use-continue' }]);
    assert.deepEqual([rescued.status, rescued.continuesUsed, rescued.past.length], ['playing', 1, 0]);
    const lostAgain = played(mods, rules, [move(2), move(1), move(2), { type: 'use-continue' }, move(2)]);
    assert.equal(gameSessionReducer(rules, lostAgain, { type: 'use-continue' }), lostAgain, 'a second rescue was given');
  });
  return checked;
}

/** save-before-publish: the store writes before any subscriber sees the change; a failed write publishes nothing. */
function probeStore(host, mods, report) {
  if (!mods.store || !mods.transitions || !mods.tally) return 0;
  const { rules } = tallyRules(mods);
  const initial = played(mods, rules, []);
  const file = `${host.storeDir}/game-session-store.ts`;
  return probe(report, { file, rule: 'save-before-publish', name: 'persist runs before set(), and a failed write publishes nothing', fix: 'dispatch: const next = gameSessionReducer(...); if (next === current) return ok; const saved = persist(next, action); if (!saved.ok) return saved; set({ session: next }).' }, () => {
    const order = [];
    const store = mods.store.createGameSessionStore({ rules, initial, persist: (session) => {
      order.push(`persist ${session.moveCount} shown ${store.getState().session.moveCount}`);
      return { ok: true, value: undefined };
    } });
    store.subscribe((state) => order.push(`publish ${state.session.moveCount}`));
    store.getState().dispatch(move(1));
    assert.deepEqual(order, ['persist 1 shown 0', 'publish 1']);
    const failing = mods.store.createGameSessionStore({ rules, initial, persist: () => ({ ok: false, error: { kind: 'storage-full' } }) });
    let published = 0;
    failing.subscribe(() => { published += 1; });
    const result = failing.getState().dispatch(move(1));
    assert.equal(result.ok, false, 'the failure was not returned');
    assert.equal(published, 0, 'a failed write was published');
  });
}

/** saved-run-validated: the game's parsers decide; the snapshot wins; a resumed run is paused. */
function probeSavedRun(host, mods, report) {
  if (!mods.savedRun || !mods.transitions || !mods.tally) return 0;
  const { game, rules } = tallyRules(mods);
  const file = `${host.storeDir}/saved-run.ts`;
  return probe(report, { file, rule: 'saved-run-validated', name: 'restoreRun validates with the game\'s parsers, keeps the snapshot, resumes paused', fix: 'Restore saved-run.ts: parseState/migrateState decide (null drops the run alone), the log replay only rebuilds undo and must reproduce the snapshot, a playing run comes back paused.' }, () => {
    const target = { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true };
    const saved = mods.savedRun.toSavedRun(played(mods, rules, [move(1)]), target);
    assert.equal(mods.savedRun.restoreRun(rules, game.persistence, { ...saved, state: { count: 'x' } }).kind, 'dropped', 'an unreadable state was restored');
    const restored = mods.savedRun.restoreRun(rules, game.persistence, saved);
    assert.equal(restored.session?.status, 'paused', 'a playing run did not come back paused');
    const differs = mods.savedRun.restoreRun(rules, game.persistence, { ...saved, state: { count: 3, target: 4 } });
    assert.deepEqual([differs.hasHistory, differs.session?.state], [false, { count: 3, target: 4 }], 'the replay overrode the snapshot');
  });
}

const SETTLED = () => ({ ok: true, value: undefined });

function controllerFor(mods, initial, overrides = {}) {
  const { game, rules } = tallyRules(mods);
  const runs = mods.fakeRuns.createFakeGameRunsRepository();
  const played = [];
  const entry = game.levels?.table.find((item) => item.level === initial.ref.level) ?? null;
  const controller = mods.controller.createSessionController({
    gameId: 'tally', rules, hud: game.rules.hud, counters: game.stats.counters, entry, table: game.levels?.table ?? [],
    intentToMove: game.input.intentToMove, gameRules: game.rules, persistence: game.persistence,
    examples: game.testing.examples, runs, nowMs: () => 0,
    feedback: (result) => played.push({ result, recorded: runs.data().runEnds.length }),
    tutorial: null, settlePrevious: SETTLED, isWrittenOnBegin: false,
    ...overrides,
  }, initial);
  return { controller, runs, played };
}

/** run-end-once, result-feedback, rescue-pending, intent-legality, counters, stars, failures: the controller. */
function probeController(host, mods, report) {
  if (!mods.controller || !mods.fakeRuns || !mods.transitions || !mods.tally) return 0;
  const { rules } = tallyRules(mods);
  const start = () => played(mods, rules, []);
  const file = `${host.hostDir}/session-controller.ts`;
  const persistFile = `${host.hostDir}/session-persist.ts`;
  let checked = probe(report, { file: persistFile, rule: 'run-end-once', name: 'a win is recorded once, in one write, before the result is published', fix: 'In the persist step: a decided run with no rescue pending records its end with ONE repository call (recordRunEnd) and sets the summary before the store publishes; never again for the same run.' }, () => {
    const { controller, runs } = controllerFor(mods, start());
    const seen = [];
    controller.handle.subscribe(() => {
      const view = controller.handle.getView();
      if (view.status === 'won') seen.push(view.summary === null ? 'no summary' : `recorded ${runs.data().runEnds.length}`);
    });
    for (const col of [1, 1, 1]) controller.sendIntent(tap(col));
    controller.handle.send({ type: 'finish' });
    assert.deepEqual(runs.writes(), ['write-run', 'record-run-end']);
    assert.deepEqual(seen, ['recorded 1'], 'the won run was shown before its end was on disk');
  });
  checked += probe(report, { file: persistFile, rule: 'result-feedback', name: 'the deciding move plays win or lose once, after its write; declining the rescue plays nothing', fix: 'Call deps.feedback(\'win\' | \'lose\') once, in the persist step after the write succeeded, only for the move that decided the run (never for finish, the declined rescue).' }, () => {
    const { controller, played: feedback } = controllerFor(mods, start());
    for (const col of [1, 1, 1]) controller.sendIntent(tap(col));
    assert.deepEqual(feedback, [{ result: 'win', recorded: 1 }]);
    const rescuable = controllerFor(mods, start());
    for (const col of [1, 0, 1]) rescuable.controller.sendIntent(tap(col));
    rescuable.controller.handle.send({ type: 'finish' });
    assert.deepEqual(rescuable.played.map((item) => item.result), ['lose'], 'a rescuable loss played its feedback more or less than once');
  });
  checked += probeDailyPractice(persistFile, mods, report);
  checked += probe(report, { file: persistFile, rule: 'rescue-pending', name: 'a rescuable loss stays saved and unrecorded until declined', fix: 'A loss whose rescue is pending is written as the run (resumable), not recorded; finish (decline) records it once.' }, () => {
    const { controller, runs } = controllerFor(mods, played(mods, rules, [move(2), move(1)]));
    controller.sendIntent(tap(1));
    assert.deepEqual([runs.data().runEnds.length, runs.data().runs.get('tally')?.state], [0, { count: 5, target: 4 }]);
    controller.handle.send({ type: 'finish' });
    assert.equal(runs.data().runEnds.length, 1, 'declining did not record the loss');
  });
  checked += probe(report, { file, rule: 'intent-legality', name: 'a tap the game does not turn into a move changes nothing', fix: 'sendIntent asks the game\'s intentToMove and dispatches only a non-null move.' }, () => {
    const { controller, runs } = controllerFor(mods, start());
    controller.sendIntent(tap(0, 'tray'));
    assert.deepEqual([controller.handle.getView().moveCount, runs.writes().length], [0, 0]);
  });
  checked += probe(report, { file: `${host.hostDir}/run-summary.ts`, rule: 'stars-from-table', name: 'stars are rated on the level\'s own star rule', fix: 'summarizeRun rates a won level with starsFor(entry.stars, { isWon, moves, score }); 0 for losses, dailies and endless runs.' }, () => {
    const atPar = controllerFor(mods, start());
    for (const col of [1, 1]) atPar.controller.sendIntent(tap(col));
    const slow = controllerFor(mods, start());
    for (const col of [0, 0, 0, 0]) slow.controller.sendIntent(tap(col));
    assert.deepEqual([atPar.runs.data().runEnds[0]?.stars, slow.runs.data().runEnds[0]?.stars], [3, 2]);
  });
  checked += probe(report, { file: `${host.hostDir}/measure-counters.ts`, rule: 'counters-from-log', name: 'counters count the kept moves only', fix: 'runEndOf measures each counter by replaying the kept log from create(seed, difficulty): undone moves left the log and never count.' }, () => {
    const { controller, runs } = controllerFor(mods, start());
    controller.sendIntent(tap(0));
    controller.handle.send({ type: 'undo' });
    controller.sendIntent(tap(1));
    controller.sendIntent(tap(1));
    assert.equal(runs.data().runEnds[0]?.counters?.adds?.value, 2);
  });
  checked += probe(report, { file, rule: 'save-failure-shown', name: 'a failed write changes nothing on screen and is shown', fix: 'When dispatch returns a failure, set the view\'s saveFailure and notify; the board shows nothing that is not on disk.' }, () => {
    const { controller, runs } = controllerFor(mods, start());
    runs.failNextWrite({ kind: 'storage-full' });
    controller.sendIntent(tap(0));
    const view = controller.handle.getView();
    assert.deepEqual([view.moveCount, view.saveFailure?.kind], [0, 'storage-full']);
    const fresh = controllerFor(mods, start(), { isWrittenOnBegin: true });
    fresh.runs.failNextWrite({ kind: 'storage-busy' });
    fresh.controller.handle.begin();
    assert.equal(fresh.controller.handle.getView().saveFailure?.kind, 'storage-busy', 'a failed first write of a new run was not shown');
  });
  checked += probeSavePoints(persistFile, mods, report);
  return checked;
}

/** daily-practice: the first finished attempt of a date is the day's result; a replay counts nothing. */
function probeDailyPractice(file, mods, report) {
  const { rules } = tallyRules(mods);
  const daily = { kind: 'daily', date: '2026-10-14' };
  return probe(report, { file, rule: 'daily-practice', name: 'a replayed daily is practice: never a new best, the first result stays', fix: 'In recordFinishedRun: a daily whose date already has a run end (runs.hasRunEnd) is practice; summarizeRun gives it no new best, and its RunEndRecord carries isPractice: true so the repository raises no best, statistic or streak.' }, () => {
    const runs = mods.fakeRuns.createFakeGameRunsRepository();
    const startDaily = () => ({ ...played(mods, rules, []), ref: daily });
    const first = controllerFor(mods, startDaily(), { runs });
    for (const col of [1, 0, 1]) first.controller.sendIntent(tap(col));
    first.controller.handle.send({ type: 'finish' });
    const replay = controllerFor(mods, startDaily(), { runs });
    for (const col of [1, 1]) replay.controller.sendIntent(tap(col));
    const ends = runs.data().runEnds;
    assert.equal(ends.length, 2, 'the daily and its replay were not both recorded');
    assert.deepEqual([ends[1]?.isPractice, replay.controller.handle.getView().summary?.isNewBest], [true, false], 'the replayed daily was not practice, or became a new best');
    assert.equal(runs.bestScore('tally', daily).value, null, 'the replayed daily raised the best');
  });
}

/** save-point-write: a save-points (real-time) game writes at its save points, never per move. */
function probeSavePoints(file, mods, report) {
  const { game, rules } = tallyRules(mods);
  const persistence = { ...game.persistence, savePolicy: { kind: 'save-points', points: ['pause', 'level-end'] } };
  return probe(report, { file, rule: 'save-point-write', name: 'a save-points game writes at a save point, never per move, and records a deciding save point once', fix: 'controller.savePoint(state, moves) dispatches sync-state through the store; the persist step writes a sync-state (or pause) whatever the save policy, writes moves only for after-every-move games, and records a decided run once.' }, () => {
    const { controller, runs, played: feedback } = controllerFor(mods, played(mods, rules, []), { persistence });
    assert.equal(typeof controller.savePoint, 'function', 'the controller has no savePoint for the board\'s onSavePoint');
    controller.sendIntent(tap(0));
    assert.deepEqual(runs.writes(), [], 'a save-points game wrote a move');
    controller.savePoint({ count: 2, target: 4 }, [ONE, ONE]);
    assert.deepEqual(runs.data().runs.get('tally')?.state, { count: 2, target: 4 }, 'the save point was not written');
    controller.savePoint({ count: 4, target: 4 }, [ONE, ONE, TWO]);
    assert.deepEqual([runs.writes(), feedback.length], [['write-run', 'record-run-end'], 1], 'the deciding save point was not recorded once');
  });
}

/** saved-run-validated (at boot) and debug-run-end: the host. */
function probeHost(host, mods, report) {
  if (!mods.gameHost || !mods.fakeRuns || !mods.savedRun || !mods.transitions || !mods.tally) return 0;
  const { game, rules } = tallyRules(mods);
  const hosted = { ...game, Surface: () => null };
  const depsWith = (runs, feedback = () => undefined) => ({
    runs, clock: { nowMs: () => 0, today: () => '2026-10-14' }, errorLog: { record: () => undefined },
    options: { isContinueAllowed: true, freeHintsPerDay: 0 }, feedback, createBoardHost: () => () => null,
  });
  const file = `${host.hostDir}/game-host.ts`;
  const runsFile = `${host.hostDir}/host-runs.ts`;
  let checked = probe(report, { file, rule: 'saved-run-validated', name: 'createGameHost drops an unreadable saved run at boot, alone', fix: 'At boot, read the saved run and validate it with the game\'s parsers (resumeSession); clear only that run when it returns null.' }, () => {
    const saved = mods.savedRun.toSavedRun(played(mods, rules, [move(1)]), { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true });
    const runs = mods.fakeRuns.createFakeGameRunsRepository([{ ...saved, state: null }]);
    mods.gameHost.createGameHost(hosted, depsWith(runs));
    assert.equal(runs.data().runs.size, 0, 'the unreadable run is still saved');
  });
  checked += probe(report, { file, rule: 'debug-run-end', name: 'the debug controls end a run through the real run-end write', fix: 'debugControls().endActiveRun stages the game\'s example through the store (stage-state), so the same persist step records the end.' }, () => {
    const runs = mods.fakeRuns.createFakeGameRunsRepository();
    const gameHost = mods.gameHost.createGameHost(hosted, depsWith(runs));
    gameHost.openSession({ start: 'new', ref: LEVEL_1 })?.handle.begin?.();
    assert.equal(gameHost.debugControls().endActiveRun('win'), true);
    assert.equal(runs.data().runEnds.length, 1, 'the debug win was not recorded');
  });
  checked += probe(report, { file: runsFile, rule: 'abandoned-run-recorded', name: 'a new run first records an abandoned pending loss, and never overwrites it unrecorded', fix: 'Before a new run\'s first write, read the game\'s saved run; when it restores decided (a pending loss included), record it declined with recordRunEnd; when that fails, write nothing and show the failure (host-runs.ts settleAbandoned, the controller\'s settlePrevious).' }, () => {
    const lostRun = () => mods.savedRun.toSavedRun(played(mods, rules, [move(2), move(1), move(2)]), { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true });
    const runs = mods.fakeRuns.createFakeGameRunsRepository([lostRun()]);
    const gameHost = mods.gameHost.createGameHost(hosted, depsWith(runs));
    gameHost.openSession({ start: 'new', ref: { kind: 'level', level: 2 } })?.handle.begin?.();
    assert.deepEqual([runs.data().runEnds.length, runs.data().runs.get('tally')?.ref?.level], [1, 2], 'the abandoned pending loss was not recorded before the new run replaced it');
    const failing = mods.fakeRuns.createFakeGameRunsRepository([lostRun()]);
    const blocked = mods.gameHost.createGameHost(hosted, depsWith(failing)).openSession({ start: 'new', ref: { kind: 'level', level: 2 } });
    failing.failNextWrite({ kind: 'storage-full' });
    blocked?.handle.begin?.();
    const state = () => [failing.data().runs.get('tally')?.ref?.level, failing.data().runEnds.length];
    assert.deepEqual([...state(), blocked?.handle.getView().saveFailure?.kind], [1, 0, 'storage-full'], 'a pending loss that could not be recorded was overwritten, or the failure was not shown');
    blocked?.handle.send({ type: 'pause' });
    assert.deepEqual(state(), [2, 1], 'the next write did not record the abandoned loss first');
  });
  checked += probeTutorialRun(runsFile, mods, hosted, depsWith, report);
  return checked;
}

/** tutorial-beside-run: a tutorial plays its script beside the saved run, writing and recording nothing. */
function probeTutorialRun(file, mods, hosted, depsWith, report) {
  const tutorial = mods.tally.TALLY_TUTORIAL;
  if (tutorial === undefined) return 0;
  const { rules } = tallyRules(mods);
  return probe(report, { file, rule: 'tutorial-beside-run', name: 'the tutorial accepts only each step\'s move and leaves the saved run untouched', fix: 'Open { kind: \'tutorial\' } from game.tutorial.start() with a repository that writes nothing (host-runs.ts), and gate sendIntent with isTutorialMoveAccepted(steps, move, moveCount).' }, () => {
    const saved = mods.savedRun.toSavedRun(played(mods, rules, [move(1)]), { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true });
    const runs = mods.fakeRuns.createFakeGameRunsRepository([saved]);
    const gameHost = mods.gameHost.createGameHost({ ...hosted, tutorial }, depsWith(runs));
    const opened = gameHost.openSession({ start: 'new', ref: { kind: 'tutorial' } });
    assert.ok(opened, 'the tutorial did not open');
    opened.handle.begin?.();
    opened.handle.send({ type: 'pause' });
    opened.handle.send({ type: 'resume' });
    assert.deepEqual(runs.writes(), [], 'the tutorial wrote to the saved runs');
    assert.deepEqual(runs.data().runs.get('tally'), saved, 'the tutorial replaced the saved run');
    assert.equal(gameHost.debugControls().endActiveRun('win'), false, 'the tutorial became the active run');
  });
}

/** tutorial-beside-run (the step gate): a tutorial step plays only the move it expects. */
function probeTutorialGate(host, mods, report) {
  const tutorial = mods.tally?.TALLY_TUTORIAL;
  if (!mods.controller || !mods.fakeRuns || !mods.transitions || tutorial === undefined) return 0;
  const { rules } = tallyRules(mods);
  return probe(report, { file: `${host.hostDir}/session-controller.ts`, rule: 'tutorial-beside-run', name: 'a tutorial step plays only the move it expects', fix: 'In sendIntent: after intentToMove, drop a move unless deps.tutorial is null or isTutorialMoveAccepted(deps.tutorial, move, session.moveCount).' }, () => {
    const { controller } = controllerFor(mods, played(mods, rules, []), { tutorial: tutorial.steps });
    controller.sendIntent(tap(0));
    assert.equal(controller.handle.getView().moveCount, 0, 'a move the first step does not expect was played');
    controller.sendIntent(tap(1));
    assert.equal(controller.handle.getView().moveCount, 1, 'the expected move was refused');
  });
}

const LOST_VIEW = { status: 'lost', continueState: 'offered', summary: null, eventSeq: 4 };

/** loss-not-stranded and play-time: the policy and the clock. */
function probePolicy(host, mods, report) {
  let checked = 0;
  if (mods.policy) {
    checked += probe(report, { file: `${host.hostDir}/run-end-policy.ts`, rule: 'loss-not-stranded', name: 'a pending loss is stranded exactly when its rescue is hidden', fix: 'isLossStranded(view, offer): status lost, continueState offered, summary null and offer \'hidden\' (a loading ad is not hidden).' }, () => {
      const { isLossStranded } = mods.policy;
      assert.deepEqual([isLossStranded(LOST_VIEW, 'hidden'), isLossStranded(LOST_VIEW, 'loading'), isLossStranded({ ...LOST_VIEW, summary: {} }, 'hidden')], [true, false, false]);
    });
    checked += probe(report, { file: `${host.hostDir}/run-end-policy.ts`, rule: 'back-guard', name: 'Back pauses in play, resumes in Pause and finishes a pending loss; it leaves only a recorded run', fix: 'backCommandOf(view): playing -> { type: \'pause\' }, paused -> { type: \'resume\' }, a lost run with continueState offered -> { type: \'finish\' }, otherwise (or once summary is set) null.' }, () => {
      const { backCommandOf } = mods.policy;
      assert.equal(typeof backCommandOf, 'function', 'run-end-policy.ts has no backCommandOf');
      const types = [{ ...LOST_VIEW, status: 'playing' }, { ...LOST_VIEW, status: 'paused' }, LOST_VIEW, { ...LOST_VIEW, summary: {} }, null].map((view) => backCommandOf(view)?.type ?? null);
      assert.deepEqual(types, ['pause', 'resume', 'finish', null, null]);
    });
  }
  if (mods.playClock) {
    checked += probe(report, { file: `${host.hostDir}/play-clock.ts`, rule: 'play-time', name: 'only playing time counts, each step clamped to 0..300000 ms', fix: 'createPlayClock(nowMs).lap(wasPlaying): 0 when not playing; elapsed clamped to 0..MAX_PLAY_DELTA_MS.' }, () => {
      let now = 0;
      const clock = mods.playClock.createPlayClock(() => now);
      now = 3_600_000;
      const jump = clock.lap(true);
      now = 1000;
      assert.deepEqual([jump, clock.lap(true), clock.lap(false)], [300_000, 0, 0]);
    });
  }
  return checked;
}

export function runHostProbes(host, mods, report) {
  return probeTransitions(host, mods, report) + probeStore(host, mods, report) + probeSavedRun(host, mods, report)
    + probeController(host, mods, report) + probeTutorialGate(host, mods, report) + probeHost(host, mods, report)
    + probePolicy(host, mods, report);
}

/** The exported GameModule of <id>-game.ts: the object with identity, engine, input, rules, persistence. */
function moduleOf(mod) {
  return Object.values(mod).find((value) => value && typeof value === 'object' && value.engine && value.input && value.rules && value.persistence) ?? null;
}

/** config-rules and save-policy: one game's options and save policy against its rules. */
export async function probeGameRules(host, app, id, report) {
  const gameRel = `${host.gamesDir}/${id}/${id}-game.ts`;
  if (!host.exists(gameRel)) return 0;
  let game;
  try {
    game = moduleOf(await app.load(gameRel));
    if (game === null) throw new Error('it exports no GameModule');
  } catch (error) {
    report.problem({ file: gameRel, line: 1, rule: 'host-load', message: `cannot run in Node: ${errorText(error)}`, fix: 'The game module imports only its rules, canvas intent function and testing (game-rules-engine keeps them pure).' });
    return 1;
  }
  const isRealtime = host.exists(`${host.gamesDir}/${id}/sim`);
  const isSavePoints = game.persistence.savePolicy?.kind === 'save-points';
  if (isRealtime !== isSavePoints) {
    report.problem({ file: gameRel, line: 1, rule: 'save-policy', message: isRealtime ? 'a game with a real-time loop (sim/) saves after every move' : 'a turn-based game (no sim/) saves only at save points', fix: 'Turn-based: savePolicy { kind: \'after-every-move\' }. Real-time (realtime-game-loop): { kind: \'save-points\', points: [...] }, never per frame.' });
  }
  await probeTutorial(host, app, { id, game }, report);
  if (!host.exists(host.config)) {
    report.problem({ file: host.config, rule: 'config-rules', message: `no per-game options for ${id}`, fix: 'Write src/config/game-host-config.ts (examples/app-wiring/game-host-config.ts) with isContinueAllowed and freeHintsPerDay for each game.' });
    return 1;
  }
  let options;
  try {
    options = (await app.load(host.config)).GAME_HOST_CONFIG?.[id];
  } catch (error) {
    report.problem({ file: host.config, line: 1, rule: 'host-load', message: `cannot run in Node: ${errorText(error)}`, fix: 'Keep the config plain data with type-only imports.' });
    return 1;
  }
  if (options === undefined) {
    report.problem({ file: host.config, line: 1, rule: 'config-rules', message: `GAME_HOST_CONFIG has no entry for ${id}`, fix: `Add '${id}': { isContinueAllowed, freeHintsPerDay } from the game's rules.` });
  } else {
    if (options.isContinueAllowed === true && game.rules.continueRun?.kind !== 'once') report.problem({ file: host.config, line: 1, rule: 'config-rules', message: `${id}: isContinueAllowed is true but the rules offer no rescue (continueRun ${game.rules.continueRun?.kind})`, fix: 'Set isContinueAllowed: false, or give the rules continueRun { kind: \'once\', ... } (game-rules-engine).' });
    if (options.freeHintsPerDay > 0 && game.rules.hints?.kind !== 'solver') report.problem({ file: host.config, line: 1, rule: 'config-rules', message: `${id}: freeHintsPerDay is ${options.freeHintsPerDay} but the rules have no hints`, fix: 'Set freeHintsPerDay: 0, or give the rules hints { kind: \'solver\', suggest }.' });
  }
  return 1;
}

/** The exported TutorialSpec of a tutorial file: the object with start() and steps. */
function tutorialOf(mod) {
  return Object.values(mod).find((value) => value && typeof value === 'object' && typeof value.start === 'function' && Array.isArray(value.steps)) ?? null;
}

/** Why the script cannot be played from its start, or null: each step's move must be legal then. */
function illegalStep(game, tutorial) {
  let state = tutorial.start();
  for (const [index, step] of tutorial.steps.entries()) {
    if (game.engine.outcome(state).kind !== 'playing') return `step ${index + 1} comes after the run is already decided`;
    const legal = game.engine.listMoves(state);
    const move = step.expect?.kind === 'any-move' ? legal[0] : step.expect?.move;
    if (move === undefined || !legal.some((candidate) => isDeepStrictEqual(candidate, move))) {
      return `step ${index + 1} expects ${JSON.stringify(move ?? null)}, which listMoves does not offer at that point`;
    }
    state = game.engine.applyMove(state, move).state;
  }
  return null;
}

/**
 * tutorial-legal: a binding with a tutorial keeps it in <id>/tutorial/<id>-tutorial.ts (pure), and
 * every step replays legally from its start through the game's own engine, headless.
 */
async function probeTutorial(host, app, { id, game }, report) {
  const binding = [`${host.gamesDir}/${id}/${id}-hosted.ts`, `${host.gamesDir}/${id}/${id}-hosted.tsx`].find((rel) => host.exists(rel));
  const rel = `${host.gamesDir}/${id}/tutorial/${id}-tutorial.ts`;
  const hasMember = binding !== undefined && /\btutorial\s*:/.test(host.read(binding));
  if (!host.exists(rel)) {
    if (hasMember) report.problem({ file: binding, line: 1, rule: 'tutorial-legal', message: `the binding has a tutorial, but ${rel} does not exist`, fix: `Keep the tutorial as pure data in ${rel} (examples/app-wiring/lights-out-tutorial.ts), so the checker can replay it.` });
    return;
  }
  let tutorial;
  try {
    tutorial = tutorialOf(await app.load(rel));
    if (tutorial === null) throw new Error('it exports no TutorialSpec ({ start, steps })');
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'host-load', message: `cannot run in Node: ${errorText(error)}`, fix: 'Keep the tutorial pure data: the start state, the steps and type-only imports of the seam.' });
    return;
  }
  let reason;
  try {
    reason = illegalStep(game, tutorial);
  } catch (error) {
    reason = `replaying it throws: ${errorText(error)}`;
  }
  if (reason !== null) report.problem({ file: rel, line: 1, rule: 'tutorial-legal', message: `the tutorial cannot be played: ${reason}`, fix: 'Each step\'s expected move must be one engine.listMoves(state) offers at that point, replayed from tutorial.start(); a step the player cannot make strands the tutorial.' });
}
