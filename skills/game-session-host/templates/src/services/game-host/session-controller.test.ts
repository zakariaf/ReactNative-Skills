// src/services/game-host/session-controller.test.ts
import { err, ok } from '@/core/result';
import { createFakeGameRunsRepository } from '@/data/game-runs/fake-game-runs-repository';
import { TALLY_GAME, TALLY_TUTORIAL, tallyTap } from '@test/games/tally-game';
import { TALLY_RULES, playTally, startTally } from '@test/games/tally-runs';

import { entryFor } from './open-session';
import { createSessionController } from './session-controller';

import type { ControllerDeps } from './session-controller';
import type { ResultFeedback } from './session-persist';
import type { FakeGameRunsRepository } from '@/data/game-runs/fake-game-runs-repository';
import type { TallyEvent, TallyIntent, TallyMove, TallyState } from '@test/games/tally-game';
import type { TallySession } from '@test/games/tally-runs';

type Deps = ControllerDeps<TallyState, TallyMove, TallyEvent, TallyIntent>;

function setup(
  initial: TallySession = startTally(),
  overrides: Partial<Deps> = {},
): {
  readonly controller: ReturnType<
    typeof createSessionController<TallyState, TallyMove, TallyEvent, TallyIntent>
  >;
  readonly runs: FakeGameRunsRepository;
  readonly played: ResultFeedback[];
  readonly time: { now: number };
} {
  const runs = createFakeGameRunsRepository();
  const played: ResultFeedback[] = [];
  const time = { now: 0 };
  const deps: Deps = {
    gameId: 'tally',
    rules: TALLY_RULES,
    hud: TALLY_GAME.rules.hud,
    counters: TALLY_GAME.stats.counters,
    entry: entryFor(TALLY_GAME, initial.ref),
    table: TALLY_GAME.levels?.table ?? [],
    intentToMove: TALLY_GAME.input.intentToMove,
    gameRules: TALLY_GAME.rules,
    persistence: TALLY_GAME.persistence,
    examples: TALLY_GAME.testing.examples,
    runs,
    nowMs: () => time.now,
    feedback: (result) => {
      played.push(result);
    },
    tutorial: null,
    settlePrevious: () => ok(undefined),
    isWrittenOnBegin: false,
    ...overrides,
  };
  return { controller: createSessionController(deps, initial), runs, played, time };
}

describe('createSessionController', () => {
  it('saves every move before the screen sees it', () => {
    const { controller, runs } = setup();
    const seen: string[] = [];
    controller.handle.subscribe(() => {
      seen.push(
        `view ${String(controller.handle.getView().moveCount)}, saved ${JSON.stringify(runs.data().runs.get('tally')?.state)}`,
      );
    });
    controller.sendIntent(tallyTap(0));

    expect(seen).toStrictEqual(['view 1, saved {"count":1,"target":4}']);
  });

  it('makes moves only through the game intentToMove (null = nothing happens)', () => {
    const { controller, runs } = setup();
    controller.sendIntent({
      kind: 'tap',
      target: { regionId: 'tray', col: 0, row: 0 },
      selected: null,
    });

    expect(controller.handle.getView().moveCount).toBe(0);
    expect(runs.writes()).toStrictEqual([]);
  });

  it('records a win once, in one write, before the result is published, and plays win once', () => {
    const { controller, runs, played } = setup();
    const summaries: unknown[] = [];
    controller.handle.subscribe(() => {
      const view = controller.handle.getView();
      if (view.status === 'won')
        summaries.push(view.summary === null ? 'no summary' : runs.data().runEnds.length);
    });
    controller.sendIntent(tallyTap(1));
    controller.sendIntent(tallyTap(1));
    controller.sendIntent(tallyTap(1));
    controller.handle.send({ type: 'finish' });

    expect(runs.writes()).toStrictEqual(['write-run', 'record-run-end']);
    expect(summaries).toStrictEqual([1]);
    expect(played).toStrictEqual(['win']);
    expect(controller.handle.getView().summary).toMatchObject({
      isWon: true,
      stars: 3,
      nextLevel: 2,
    });
  });

  it('keeps a rescuable loss pending (saved), then records it when declined', () => {
    const { controller, runs, played } = setup(playTally(startTally(), [2, 1]));
    controller.sendIntent(tallyTap(1));

    expect(controller.handle.getView()).toMatchObject({
      status: 'lost',
      continueState: 'offered',
      summary: null,
    });
    expect(runs.data().runs.get('tally')?.state).toStrictEqual({ count: 5, target: 4 });
    expect(played).toStrictEqual(['lose']);

    controller.handle.send({ type: 'finish' });

    expect(runs.data().runEnds).toHaveLength(1);
    expect(runs.data().runs.size).toBe(0);
    expect(controller.handle.getView().summary).toMatchObject({ isWon: false, stars: 0 });
    expect(played).toStrictEqual(['lose']);
  });

  it('rescues once, and the second loss is final', () => {
    const { controller, runs } = setup(playTally(startTally(), [2, 1]));
    controller.sendIntent(tallyTap(1));
    controller.handle.send({ type: 'continue' });

    expect(controller.handle.getView()).toMatchObject({ status: 'playing', continueState: 'used' });

    controller.sendIntent(tallyTap(1));

    expect(controller.handle.getView().status).toBe('lost');
    expect(runs.data().runEnds).toHaveLength(1);
  });

  it('shows a hint for the current position and counts it', () => {
    const { controller } = setup();
    controller.handle.send({ type: 'hint' });

    expect(controller.hintedMove()).toStrictEqual({ kind: 'add', amount: 2 });
    expect(controller.handle.getView().isHintShown).toBe(true);

    controller.sendIntent(tallyTap(0));

    expect(controller.hintedMove()).toBeNull();
  });

  it('counts play time only while playing, and a pause writes it', () => {
    const { controller, runs, time } = setup();
    time.now = 4000;
    controller.handle.send({ type: 'pause' });
    time.now = 60_000;
    controller.handle.send({ type: 'resume' });

    expect(runs.data().runs.get('tally')?.playMs).toBe(4000);
    expect(controller.store.getState().session.playMs).toBe(4000);
  });

  it('leaves a live run saved for Home, not for the next launch', () => {
    const { controller, runs } = setup();
    controller.sendIntent(tallyTap(0));
    controller.handle.send({ type: 'leave' });

    expect(runs.data().runs.get('tally')?.shouldResumeOnLaunch).toBe(false);
  });

  it('shows a failed write and changes nothing on screen', () => {
    const { controller, runs } = setup();
    runs.failNextWrite({ kind: 'storage-full' });
    controller.sendIntent(tallyTap(0));

    expect(controller.handle.getView()).toMatchObject({
      moveCount: 0,
      saveFailure: { kind: 'storage-full' },
    });

    controller.sendIntent(tallyTap(0));

    expect(controller.handle.getView()).toMatchObject({ moveCount: 1, saveFailure: null });
  });

  it('ends a run from a test build through the same run-end write', () => {
    const { controller, runs, played } = setup();

    expect(controller.endWith('win')).toBe(true);
    expect(runs.data().runEnds).toHaveLength(1);
    expect(played).toStrictEqual(['win']);
    expect(controller.endWith('lose')).toBe(false);
  });

  it('records a reopened loss when it begins, once its rescue is no longer allowed', () => {
    const lost = playTally(startTally(), [2, 1, 2]);
    const { controller, runs } = setup({ ...lost, continuesUsed: 1 });

    expect(runs.data().runEnds).toHaveLength(0);

    controller.handle.begin();
    controller.handle.begin();

    expect(runs.data().runEnds).toHaveLength(1);
    expect(controller.handle.getView().summary).not.toBeNull();
  });

  it('writes a new run when it begins, once, after the previous run is settled', () => {
    const order: string[] = [];
    const { controller, runs } = setup(startTally(), {
      isWrittenOnBegin: true,
      settlePrevious: () => {
        order.push('settled');
        return ok(undefined);
      },
    });
    controller.handle.begin();
    controller.handle.begin();
    controller.sendIntent(tallyTap(0));

    expect(order).toStrictEqual(['settled']);
    expect(runs.writes()).toStrictEqual(['write-run', 'write-run']);
  });

  it('writes nothing while the previous run cannot be settled, and shows why', () => {
    let failure: 'storage-busy' | null = 'storage-busy';
    const { controller, runs } = setup(startTally(), {
      isWrittenOnBegin: true,
      settlePrevious: () => (failure === null ? ok(undefined) : err({ kind: failure })),
    });
    controller.handle.begin();
    controller.sendIntent(tallyTap(0));

    expect(runs.writes()).toStrictEqual([]);
    expect(controller.handle.getView()).toMatchObject({
      moveCount: 0,
      saveFailure: { kind: 'storage-busy' },
    });

    failure = null;
    controller.sendIntent(tallyTap(0));

    expect(runs.writes()).toStrictEqual(['write-run']);
    expect(controller.handle.getView()).toMatchObject({ moveCount: 1, saveFailure: null });
  });

  it('shows a failed first write of a new run, so the screen can offer a retry', () => {
    const { controller, runs } = setup(startTally(), { isWrittenOnBegin: true });
    runs.failNextWrite({ kind: 'storage-full' });
    controller.handle.begin();

    expect(controller.handle.getView().saveFailure).toStrictEqual({ kind: 'storage-full' });
  });

  it('writes a save-points game at its save points, never per move, and records the end once', () => {
    const savePoints = {
      ...TALLY_GAME.persistence,
      savePolicy: { kind: 'save-points', points: ['pause', 'level-end'] },
    } as const;
    const { controller, runs, played } = setup(startTally(), { persistence: savePoints });
    controller.sendIntent(tallyTap(0));

    expect(runs.writes()).toStrictEqual([]);

    controller.savePoint({ count: 3, target: 4 }, [{ kind: 'add', amount: 1 }]);

    expect(runs.data().runs.get('tally')?.state).toStrictEqual({ count: 3, target: 4 });

    controller.savePoint({ count: 4, target: 4 }, []);

    expect(runs.writes()).toStrictEqual(['write-run', 'record-run-end']);
    expect(played).toStrictEqual(['win']);
    expect(controller.handle.getView().summary).toMatchObject({ isWon: true });
  });

  it('plays a tutorial step only with the move it expects', () => {
    const { controller } = setup(startTally(), { tutorial: TALLY_TUTORIAL.steps });

    expect(controller.handle.getView().tutorialStep?.index).toBe(0);

    controller.sendIntent(tallyTap(0));

    expect(controller.handle.getView().moveCount).toBe(0);

    controller.sendIntent(tallyTap(1));
    controller.sendIntent(tallyTap(0));

    expect(controller.handle.getView()).toMatchObject({ moveCount: 2, tutorialStep: null });
  });

  it('gives a paid hint while paused (the hint ad paused the run)', () => {
    const { controller } = setup();
    controller.handle.send({ type: 'pause' });
    controller.handle.send({ type: 'hint' });

    expect(controller.handle.getView()).toMatchObject({ status: 'paused', isHintShown: true });
  });

  it('keeps the view the same object until something changed', () => {
    const { controller } = setup();
    const first = controller.handle.getView();

    expect(controller.handle.getView()).toBe(first);
  });
});
