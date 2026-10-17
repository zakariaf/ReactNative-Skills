// test/sqlite/tasks-benchmark.test.ts
// The storage benchmark's opener on real SQLite (node:sqlite): it seeds the largest realistic data
// through the app's open path, its write is one real change, and close deletes the scratch file.
import { existsSync } from 'node:fs';

import {
  LARGEST_REALISTIC_TASKS,
  createTasksBenchmarkOpener,
  seedLargestRealisticTasks,
} from '@/data/perf/tasks-benchmark';
import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createNodeDatabaseFiles } from '@test/sqlite/node-database-files';
import { createNodeSqliteSqlDriver } from '@test/sqlite/node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from '@test/sqlite/temp-database-folder';

import type { TempDatabaseFolder } from '@test/sqlite/temp-database-folder';

let folder: TempDatabaseFolder;

function openBenchmark(): ReturnType<ReturnType<typeof createTasksBenchmarkOpener>> {
  const open = createTasksBenchmarkOpener({
    openDriver: (name) => createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
    files: createNodeDatabaseFiles(),
    clock: { nowMs: () => 1_790_000_000_000 },
    errorLog: createFakeErrorLog(),
  });
  return open('perf-bench.db');
}

describe('the storage benchmark data', () => {
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
  });

  afterEach(() => {
    folder.remove();
  });

  it('seeds the largest realistic data and returns every task id', () => {
    const ids = seedLargestRealisticTasks(createFakeTaskRepository());
    expect([ids.length, new Set(ids).size]).toStrictEqual([
      LARGEST_REALISTIC_TASKS,
      LARGEST_REALISTIC_TASKS,
    ]);
  });

  it('opens the scratch file, writes to it, and deletes it on close', () => {
    const target = openBenchmark();
    expect(existsSync(folder.file('perf-bench.db'))).toBe(true);
    target.write(0);
    target.write(1);
    target.close();
    expect(
      ['perf-bench.db', 'perf-bench.db-wal', 'perf-bench.db-shm'].map((name) =>
        existsSync(folder.file(name)),
      ),
    ).toStrictEqual([false, false, false]);
  });

  it('starts every run from the same data', () => {
    openBenchmark().close();
    const target = openBenchmark();
    expect(() => {
      target.write(LARGEST_REALISTIC_TASKS - 1);
    }).not.toThrow();
    target.close();
  });
});
