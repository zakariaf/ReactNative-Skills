// test/sqlite/sqlite-game-runs-repository.test.ts
// The run repository on real SQL (node:sqlite), through the app's own open path, with the
// create-game-runs migration appended to MIGRATIONS.
import { openAppDatabase } from '@/data/app-database';
import { createSqliteGameRunsRepository } from '@/data/game-runs/sqlite-game-runs-repository';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeDatabaseFiles } from './node-database-files';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { AppDatabase } from '@/data/app-database';
import type { RunEndRecord, SavedRun } from '@/data/game-runs/game-runs-repository';

const RUN: SavedRun = {
  gameId: 'lights-out',
  ref: { kind: 'level', level: 2 },
  seed: 2,
  difficulty: 10,
  startedOn: '2026-10-14',
  stateVersion: 1,
  state: { lights: [1, 0, 1] },
  log: [{ kind: 'move', move: { cell: 1 } }, { kind: 'continue' }],
  moveCount: 1,
  undoCount: 0,
  hintsUsed: 1,
  continuesUsed: 1,
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
  hintsUsed: 1,
  counters: { taps: { value: 3, aggregate: 'sum' } },
  isPractice: false,
};

describe('createSqliteGameRunsRepository', () => {
  let folder: TempDatabaseFolder;
  let database: AppDatabase;
  const errorLog = createFakeErrorLog();
  const repository = () => createSqliteGameRunsRepository({ driver: database.driver, errorLog });
  const count = (table: string): unknown =>
    database.driver.get(`SELECT count(*) AS n FROM ${table}`, [])?.['n'];

  beforeEach(() => {
    folder = makeTempDatabaseFolder();
    database = openAppDatabase({
      openDriver: (name) =>
        createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
      files: createNodeDatabaseFiles(),
      fileName: 'app.db',
      migrations: MIGRATIONS,
      errorLog,
    });
  });
  afterEach(() => {
    folder.remove();
  });

  it('keeps one run in progress per game and reads it back', () => {
    const repo = repository();

    expect(repo.writeRun(RUN).ok).toBe(true);
    expect(repo.writeRun({ ...RUN, moveCount: 2 }).ok).toBe(true);
    expect(repo.savedRun('lights-out')).toStrictEqual({
      ok: true,
      value: { ...RUN, moveCount: 2 },
    });
    expect(count('game_saved_runs')).toBe(1);
  });

  it('refuses an invalid run and writes nothing', () => {
    expect(repository().writeRun({ ...RUN, seed: -1 })).toStrictEqual({
      ok: false,
      error: { kind: 'run-invalid', field: 'seed' },
    });
    expect(count('game_saved_runs')).toBe(0);
  });

  it('records a run end in one transaction: the best, the end row, the run cleared', () => {
    const repo = repository();
    repo.writeRun(RUN);

    expect(repo.recordRunEnd(WON).ok).toBe(true);
    expect(repo.bestScore('lights-out', WON.ref)).toStrictEqual({ ok: true, value: 40 });
    expect([count('game_run_ends'), count('game_saved_runs')]).toStrictEqual([1, 0]);

    repo.recordRunEnd({ ...WON, score: 20 });

    expect(repo.bestScore('lights-out', WON.ref)).toStrictEqual({ ok: true, value: 40 });
  });

  it('keeps the first daily result: a replay is a practice row that raises nothing', () => {
    const repo = repository();
    const daily = { ...WON, ref: { kind: 'daily', date: '2026-10-14' } } as const;

    expect(repo.hasRunEnd('lights-out', daily.ref)).toStrictEqual({ ok: true, value: false });
    repo.recordRunEnd({ ...daily, isWon: false, score: 10, stars: 0 });
    repo.recordRunEnd({ ...daily, score: 90, isPractice: true });

    expect(repo.hasRunEnd('lights-out', daily.ref)).toStrictEqual({ ok: true, value: true });
    expect(repo.bestScore('lights-out', daily.ref)).toStrictEqual({ ok: true, value: null });
    const streakDays = database.driver.all(
      'SELECT DISTINCT day FROM game_run_ends WHERE game_id = ? AND is_practice = 0',
      ['lights-out'],
    );
    expect(streakDays).toStrictEqual([{ day: '2026-10-14' }]);
  });

  it("runs the app's extension inside the run-end transaction, and rolls back with it", () => {
    const seen: string[] = [];
    const failing = createSqliteGameRunsRepository({
      driver: database.driver,
      errorLog,
      extendRunEnd: (_driver, end) => {
        seen.push(end.day);
        throw new Error('ad history unavailable');
      },
    });
    failing.writeRun(RUN);

    expect(failing.recordRunEnd(WON).ok).toBe(false);
    expect(seen).toStrictEqual(['2026-10-14']);
    expect([count('game_run_ends'), count('game_saved_runs')]).toStrictEqual([0, 1]);
  });

  it('rolls the whole run end back when a step fails', () => {
    const repo = repository();
    repo.writeRun(RUN);
    database.driver.exec('DROP TABLE game_run_ends');

    expect(repo.recordRunEnd(WON)).toStrictEqual({
      ok: false,
      error: { kind: 'storage-unavailable' },
    });
    expect(repo.bestScore('lights-out', WON.ref)).toStrictEqual({ ok: true, value: null });
    expect(repo.savedRun('lights-out')).toStrictEqual({ ok: true, value: RUN });
  });

  it('reads an unreadable saved row as no run, and logs it', () => {
    database.driver.run('INSERT INTO game_saved_runs (game_id, run_json) VALUES (?, ?)', [
      'lights-out',
      '{"seed":"x"}',
    ]);

    expect(repository().savedRun('lights-out')).toStrictEqual({ ok: true, value: null });
    expect(errorLog.recorded.at(-1)?.source).toBe('storage');
  });

  it('reads a row of corrupt JSON as no run (not a storage failure), and logs it', () => {
    database.driver.run('INSERT INTO game_saved_runs (game_id, run_json) VALUES (?, ?)', [
      'lights-out',
      '{"gameId":"lights-',
    ]);

    expect(repository().savedRun('lights-out')).toStrictEqual({ ok: true, value: null });
    expect(errorLog.recorded.at(-1)?.source).toBe('storage');
    expect(repository().clearRun('lights-out')).toStrictEqual({ ok: true, value: undefined });
    expect(count('game_saved_runs')).toBe(0);
  });
});
