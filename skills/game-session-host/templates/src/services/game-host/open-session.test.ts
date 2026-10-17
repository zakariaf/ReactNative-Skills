// src/services/game-host/open-session.test.ts

import { dailySeed } from '@/core/dates/daily-seed';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { toSavedRun } from '@/stores/game-session/saved-run';
import { TALLY_GAME } from '@test/games/tally-game';

import { entryFor, newSession, resumeSession, sessionRulesFor, startFor } from './open-session';

const TODAY = '2026-10-14';
const TARGET = { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true };

describe('sessionRulesFor', () => {
  it('offers the game rescue only when the app allows it', () => {
    expect(sessionRulesFor(TALLY_GAME, true).continueRun.kind).toBe('once');
    expect(sessionRulesFor(TALLY_GAME, false).continueRun.kind).toBe('none');
  });
});

describe('startFor', () => {
  it('starts a level from its table entry, a daily from the date seed and endless from a new seed', () => {
    expect(startFor(TALLY_GAME, { kind: 'level', level: 2 }, () => 9)).toStrictEqual(
      entryFor(TALLY_GAME, { kind: 'level', level: 2 }),
    );
    expect(startFor(TALLY_GAME, { kind: 'daily', date: TODAY }, () => 9)).toStrictEqual({
      seed: dailySeed(TODAY, 5),
      difficulty: 2,
    });
    expect(startFor(TALLY_GAME, { kind: 'endless' }, () => 9)).toStrictEqual({
      seed: 9,
      difficulty: 100,
    });
  });

  it('has no run for an unknown level or a game without levels', () => {
    expect(startFor(TALLY_GAME, { kind: 'level', level: 99 }, () => 9)).toBeNull();
    expect(startFor({ ...TALLY_GAME, levels: null }, { kind: 'endless' }, () => 9)).toBeNull();
    expect(startFor(TALLY_GAME, { kind: 'tutorial' }, () => 9)).toBeNull();
  });
});

describe('newSession and resumeSession', () => {
  it('opens a new run playing, stamped with the day it started', () => {
    const session = newSession(TALLY_GAME, {
      ref: { kind: 'level', level: 1 },
      today: TODAY,
      newSeed: () => 1,
      isContinueAllowed: true,
    });

    expect(session?.status).toBe('playing');
    expect(session?.startedOn).toBe(TODAY);
  });

  it('resumes a saved run paused, and drops an unreadable one with a log entry', () => {
    const errorLog = createFakeErrorLog();
    const session = newSession(TALLY_GAME, {
      ref: { kind: 'level', level: 1 },
      today: TODAY,
      newSeed: () => 1,
      isContinueAllowed: true,
    });
    if (session === null) throw new Error('no run');
    const saved = toSavedRun(session, TARGET);

    expect(resumeSession(TALLY_GAME, { saved, errorLog, isContinueAllowed: true })?.status).toBe(
      'paused',
    );
    expect(
      resumeSession(TALLY_GAME, {
        saved: { ...saved, state: null },
        errorLog,
        isContinueAllowed: true,
      }),
    ).toBeNull();
    expect(errorLog.recorded).toHaveLength(1);
  });

  it('logs a replay that differs from its snapshot and keeps the position', () => {
    const errorLog = createFakeErrorLog();
    const session = newSession(TALLY_GAME, {
      ref: { kind: 'level', level: 1 },
      today: TODAY,
      newSeed: () => 1,
      isContinueAllowed: true,
    });
    if (session === null) throw new Error('no run');
    const saved = {
      ...toSavedRun(session, TARGET),
      state: { count: 2, target: 4 },
      log: [{ kind: 'move', move: { kind: 'add', amount: 1 } }],
    } as const;

    expect(
      resumeSession(TALLY_GAME, { saved, errorLog, isContinueAllowed: true })?.state,
    ).toStrictEqual({ count: 2, target: 4 });
    expect(errorLog.recorded).toHaveLength(1);
  });
});
