// src/data/game-runs/fake-game-runs-repository.test.ts
import { createFakeGameRunsRepository } from './fake-game-runs-repository';

import type { RunEndRecord, SavedRun } from '@/data/game-runs/game-runs-repository';

const RUN: SavedRun = {
  gameId: 'lights-out',
  ref: { kind: 'level', level: 2 },
  seed: 2,
  difficulty: 10,
  startedOn: '2026-10-14',
  stateVersion: 1,
  state: { lit: [1, 0, 1] },
  log: [{ kind: 'move', move: { cell: 1 } }],
  moveCount: 1,
  undoCount: 0,
  hintsUsed: 0,
  continuesUsed: 0,
  isRescueDeclined: false,
  playMs: 1500,
  shouldResumeOnLaunch: true,
};

const WON: RunEndRecord = {
  gameId: 'lights-out',
  ref: { kind: 'level', level: 2 },
  day: '2026-10-14',
  isWon: true,
  score: 40,
  moves: 3,
  playMs: 4000,
  stars: 3,
  hintsUsed: 0,
  counters: { taps: { value: 3, aggregate: 'sum' } },
  isPractice: false,
};

describe('createFakeGameRunsRepository', () => {
  it('keeps one run in progress per game and clears it alone', () => {
    const repo = createFakeGameRunsRepository();

    expect(repo.writeRun(RUN)).toStrictEqual({ ok: true, value: undefined });
    expect(repo.savedRun('lights-out')).toStrictEqual({ ok: true, value: RUN });
    expect(repo.clearRun('lights-out').ok).toBe(true);
    expect(repo.savedRun('lights-out')).toStrictEqual({ ok: true, value: null });
  });

  it('records a run end, its best and the cleared run in one write', () => {
    const repo = createFakeGameRunsRepository([RUN]);

    expect(repo.recordRunEnd(WON).ok).toBe(true);
    expect(repo.writes()).toStrictEqual(['record-run-end']);
    expect(repo.data().runs.size).toBe(0);
    expect(repo.data().runEnds).toStrictEqual([WON]);
    expect(repo.bestScore('lights-out', WON.ref)).toStrictEqual({ ok: true, value: 40 });
  });

  it('keeps the higher best and never counts a lost level', () => {
    const repo = createFakeGameRunsRepository();
    repo.recordRunEnd(WON);
    repo.recordRunEnd({ ...WON, score: 20 });
    repo.recordRunEnd({ ...WON, isWon: false, score: 90, stars: 0 });

    expect(repo.bestScore('lights-out', WON.ref)).toStrictEqual({ ok: true, value: 40 });
  });

  it('knows which run keys have a recorded end, and never counts practice', () => {
    const repo = createFakeGameRunsRepository([RUN]);
    const daily = { ...WON, ref: { kind: 'daily', date: '2026-10-14' } } as const;

    expect(repo.hasRunEnd('lights-out', daily.ref)).toStrictEqual({ ok: true, value: false });
    repo.recordRunEnd({ ...daily, score: 10 });
    repo.recordRunEnd({ ...daily, score: 90, isPractice: true });

    expect(repo.hasRunEnd('lights-out', daily.ref)).toStrictEqual({ ok: true, value: true });
    expect(repo.bestScore('lights-out', daily.ref)).toStrictEqual({ ok: true, value: 10 });
    expect(repo.data().runEnds).toHaveLength(2);
    expect(repo.data().runs.size).toBe(0);
  });

  it('counts an endless best win or not', () => {
    const repo = createFakeGameRunsRepository();
    repo.recordRunEnd({ ...WON, ref: { kind: 'endless' }, isWon: false, score: 70, stars: 0 });

    expect(repo.bestScore('lights-out', { kind: 'endless' })).toStrictEqual({
      ok: true,
      value: 70,
    });
  });

  it('fails an armed write without changing anything', () => {
    const repo = createFakeGameRunsRepository([RUN]);
    repo.failNextWrite({ kind: 'storage-full' });

    expect(repo.recordRunEnd(WON)).toStrictEqual({ ok: false, error: { kind: 'storage-full' } });
    expect(repo.data().runs.get('lights-out')).toStrictEqual(RUN);
    expect(repo.data().runEnds).toStrictEqual([]);
    expect(repo.writes()).toStrictEqual([]);
    expect(repo.recordRunEnd(WON).ok).toBe(true);
  });
});
