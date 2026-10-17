// src/services/game-host/host-runs.test.ts
import { toSavedRun } from '@/stores/game-session/saved-run';
import { createGameHostTestDeps } from '@test/games/game-host-test-deps';
import { TALLY_GAME } from '@test/games/tally-game';
import { TALLY_HOSTED } from '@test/games/tally-hosted';
import { playTally, startTally } from '@test/games/tally-runs';

import { openRun, savedSession, settleAbandoned } from './host-runs';

const TARGET = { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true };
const LEVEL_2 = { start: 'new', ref: { kind: 'level', level: 2 } } as const;

describe('savedSession', () => {
  it('validates the saved run and drops an unreadable one alone', () => {
    const readable = createGameHostTestDeps({
      saved: [toSavedRun(playTally(startTally(), [1]), TARGET)],
    });
    const unreadable = createGameHostTestDeps({
      saved: [{ ...toSavedRun(startTally(), TARGET), state: null }],
    });

    expect(savedSession(TALLY_HOSTED, readable)?.status).toBe('paused');
    expect(savedSession(TALLY_HOSTED, unreadable)).toBeNull();
    expect(unreadable.runs.data().runs.size).toBe(0);
  });
});

describe('settleAbandoned', () => {
  it('records a decided saved run once, declined, and leaves a live one alone', () => {
    const lost = createGameHostTestDeps({
      saved: [toSavedRun(playTally(startTally(), [2, 1, 2]), TARGET)],
    });
    const live = createGameHostTestDeps({
      saved: [toSavedRun(playTally(startTally(), [1]), TARGET)],
    });

    expect(settleAbandoned(TALLY_HOSTED, lost).ok).toBe(true);
    expect(lost.runs.data().runEnds).toMatchObject([{ isWon: false }]);
    expect(settleAbandoned(TALLY_HOSTED, live).ok).toBe(true);
    expect(live.runs.writes()).toStrictEqual([]);
  });
});

describe('openRun', () => {
  it('builds runs without writing, and opens nothing the game lacks', () => {
    const deps = createGameHostTestDeps();

    expect(openRun(TALLY_HOSTED, deps, LEVEL_2)?.isTutorial).toBe(false);
    expect(
      openRun(TALLY_HOSTED, deps, { start: 'new', ref: { kind: 'tutorial' } })?.isTutorial,
    ).toBe(true);
    expect(openRun({ ...TALLY_HOSTED, levels: null }, deps, LEVEL_2)).toBeNull();
    expect(openRun(TALLY_HOSTED, deps, { start: 'resume' })).toBeNull();
    expect(deps.runs.writes()).toStrictEqual([]);
  });

  it('opens no tutorial for a game without one', () => {
    const withoutTutorial = { ...TALLY_GAME, Surface: TALLY_HOSTED.Surface };
    const run = openRun(withoutTutorial, createGameHostTestDeps(), {
      start: 'new',
      ref: { kind: 'tutorial' },
    });

    expect(run).toBeNull();
  });
});
