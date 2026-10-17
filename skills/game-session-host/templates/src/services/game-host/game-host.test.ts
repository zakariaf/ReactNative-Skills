// src/services/game-host/game-host.test.ts

import { toSavedRun } from '@/stores/game-session/saved-run';
import { createGameHostTestDeps } from '@test/games/game-host-test-deps';
import { TALLY_HOSTED } from '@test/games/tally-hosted';
import { playTally, startTally } from '@test/games/tally-runs';

import { createGameHost } from './game-host';

import type { SavedRun } from '@/data/game-runs/game-runs-repository';

const TARGET = { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true };

function savedTally(amounts: readonly (1 | 2)[]): SavedRun {
  return toSavedRun(playTally(startTally(), amounts), TARGET);
}

describe('createGameHost', () => {
  it('hands screens plain facts about the game', () => {
    const host = createGameHost(
      TALLY_HOSTED,
      createGameHostTestDeps({ options: { freeHintsPerDay: 2 } }),
    );

    expect(host).toMatchObject({
      id: 'tally',
      nameId: 'tally.name',
      counters: [
        { id: 'adds', labelId: 'tally.stats.adds', aggregate: 'sum' },
        { id: 'biggest-add', labelId: 'tally.stats.biggest', aggregate: 'max' },
      ],
      hasDaily: true,
      hasEndless: true,
      hasHints: true,
      freeHintsPerDay: 2,
      hasTutorial: true,
    });
  });

  it('drops an unreadable saved run at boot, alone, with a log entry', () => {
    const deps = createGameHostTestDeps({
      saved: [{ ...savedTally([1]), state: { count: 'one' } }],
    });
    const host = createGameHost(TALLY_HOSTED, deps);

    expect(deps.runs.data().runs.size).toBe(0);
    expect(deps.errorLog.recorded).toHaveLength(1);
    expect(host.savedRun()).toBeNull();
  });

  it('keeps a readable saved run and resumes it paused', () => {
    const deps = createGameHostTestDeps({ saved: [savedTally([1, 1])] });
    const host = createGameHost(TALLY_HOSTED, deps);

    expect(host.savedRun()).toStrictEqual({
      ref: { kind: 'level', level: 1 },
      shouldResumeOnLaunch: true,
    });
    expect(host.openSession({ start: 'resume' })?.handle.getView()).toMatchObject({
      status: 'paused',
      moveCount: 2,
    });
  });

  it('writes a new run when it begins (opening is pure), so Home can offer to continue it', () => {
    const deps = createGameHostTestDeps();
    const host = createGameHost(TALLY_HOSTED, deps);
    const opened = host.openSession({ start: 'new', ref: { kind: 'endless' } });

    expect(opened?.handle.getView().status).toBe('playing');
    expect(deps.runs.writes()).toStrictEqual([]);

    opened?.handle.begin();

    expect(deps.runs.data().runs.get('tally')).toMatchObject({
      ref: { kind: 'endless' },
      seed: 7,
      startedOn: '2026-10-14',
    });
  });

  it('opens nothing for a level the game does not have, or a missing saved run', () => {
    const host = createGameHost(TALLY_HOSTED, createGameHostTestDeps());

    expect(host.openSession({ start: 'new', ref: { kind: 'level', level: 42 } })).toBeNull();
    expect(host.openSession({ start: 'resume' })).toBeNull();
  });

  it('turns the rescue off when the app does not allow it', () => {
    const deps = createGameHostTestDeps({
      options: { isContinueAllowed: false },
      saved: [savedTally([2, 1])],
    });
    const opened = createGameHost(TALLY_HOSTED, deps).openSession({ start: 'resume' });
    opened?.handle.send({ type: 'resume' });

    expect(opened?.handle.getView().continueState).toBe('none');
  });

  it('records an abandoned pending loss before a new run replaces it', () => {
    const deps = createGameHostTestDeps({ saved: [savedTally([2, 1, 2])] });
    const host = createGameHost(TALLY_HOSTED, deps);
    host.openSession({ start: 'new', ref: { kind: 'level', level: 2 } })?.handle.begin();

    expect(deps.runs.data().runEnds).toMatchObject([
      { ref: { kind: 'level', level: 1 }, isWon: false },
    ]);
    expect(deps.runs.data().runs.get('tally')?.ref).toStrictEqual({ kind: 'level', level: 2 });
  });

  it('keeps a pending loss it could not record (never overwritten) and shows the failure', () => {
    const deps = createGameHostTestDeps({ saved: [savedTally([2, 1, 2])] });
    const host = createGameHost(TALLY_HOSTED, deps);
    const opened = host.openSession({ start: 'new', ref: { kind: 'level', level: 2 } });
    deps.runs.failNextWrite({ kind: 'storage-full' });
    opened?.handle.begin();

    expect(deps.runs.data().runs.get('tally')?.ref).toStrictEqual({ kind: 'level', level: 1 });
    expect(opened?.handle.getView().saveFailure).toStrictEqual({ kind: 'storage-full' });
  });

  it('plays the tutorial beside the saved run, writing and recording nothing', () => {
    const saved = savedTally([1]);
    const deps = createGameHostTestDeps({ saved: [saved] });
    const host = createGameHost(TALLY_HOSTED, deps);
    const opened = host.openSession({ start: 'new', ref: { kind: 'tutorial' } });
    const handle = opened?.handle;
    handle?.begin();
    handle?.send({ type: 'pause' });
    handle?.send({ type: 'leave' });

    expect(handle?.getView()).toMatchObject({
      ref: { kind: 'tutorial' },
      tutorialStep: { messageId: 'tally.tutorial.add-two', index: 0, count: 2 },
    });
    expect(deps.runs.data().runs.get('tally')).toStrictEqual(saved);
    expect(deps.runs.writes()).toStrictEqual([]);
    expect(host.debugControls().endActiveRun('win')).toBe(false);
  });

  it('leaves the saved run for Home on the next launch (the crash guard)', () => {
    const deps = createGameHostTestDeps({ saved: [savedTally([1])] });
    const host = createGameHost(TALLY_HOSTED, deps);

    expect(host.leaveSavedRun().ok).toBe(true);
    expect(host.savedRun()?.shouldResumeOnLaunch).toBe(false);
    expect(createGameHost(TALLY_HOSTED, createGameHostTestDeps()).leaveSavedRun().ok).toBe(true);
  });

  it('ends the active run from the debug controls through the real run-end write', () => {
    const deps = createGameHostTestDeps();
    const host = createGameHost(TALLY_HOSTED, deps);

    expect(host.debugControls().endActiveRun('win')).toBe(false);

    host.openSession({ start: 'new', ref: { kind: 'level', level: 1 } })?.handle.begin();

    expect(host.debugControls().endActiveRun('win')).toBe(true);
    expect(deps.runs.data().runEnds).toHaveLength(1);
    expect(deps.played).toStrictEqual(['win']);
  });
});
