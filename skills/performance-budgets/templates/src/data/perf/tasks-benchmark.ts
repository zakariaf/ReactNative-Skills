// src/data/perf/tasks-benchmark.ts
// The storage benchmark's data, shared by the device benchmark (the debug menu's "Run storage
// benchmark", through createTasksBenchmarkOpener) and the Jest guard
// (test/perf/storage-write.perf.test.ts), so both time the same per-change write over the same
// largest realistic data. Tasks example: replace the seed and the write with the app's heaviest
// per-change write. Test builds reach the opener only through the test-only entry.
import { attempt } from '@/core/result';
import { openAppDatabase } from '@/data/app-database';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { createSqliteTaskRepository } from '@/data/tasks/sqlite-task-repository';

import type { Result } from '@/core/result';
import type { DatabaseFiles } from '@/data/database-files';
import type { ClosableSqlDriver } from '@/data/sql-driver';
import type { TaskRepository } from '@/data/tasks/task-repository';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The largest data a real user plausibly keeps: one list of 1,000 tasks. */
export const LARGEST_REALISTIC_TASKS = 1_000;

/** One open scratch database: the per-change write against it, and how to close and delete it. */
export type StorageBenchmarkTarget = {
  readonly write: (index: number) => void;
  readonly close: () => void;
};

function valueOrThrow<TValue>(result: Result<TValue, { readonly kind: string }>): TValue {
  // A benchmark whose writes fail must not report numbers: the debug action stops here.
  if (!result.ok) throw new Error(`storage benchmark: ${result.error.kind}`);
  return result.value;
}

/** Seeds the largest realistic data through the app's own repository; returns the task ids. */
export function seedLargestRealisticTasks(tasks: TaskRepository): readonly number[] {
  const list = valueOrThrow(tasks.addList({ name: 'Everything' }));
  return Array.from(
    { length: LARGEST_REALISTIC_TASKS },
    (_, index) =>
      valueOrThrow(tasks.addTask({ listId: list.id, title: `Task ${String(index + 1)}` })).id,
  );
}

/** The per-change write the budget is about: toggle one task (one repository transaction). */
export function toggleTaskWrite(
  tasks: TaskRepository,
  ids: readonly number[],
): (index: number) => void {
  return (index) => {
    valueOrThrow(tasks.setDone(ids[index % ids.length] ?? 1, index % 2 === 0));
  };
}

/** Closes one driver and deletes its file with the -wal and -shm companions. */
function closeAndDelete(driver: ClosableSqlDriver, files: DatabaseFiles): void {
  // Closing a driver the open path already closed throws; there is nothing left to close.
  attempt(
    () => {
      driver.close();
    },
    () => ({ kind: 'already-closed' }) as const,
  );
  if (driver.path === ':memory:') return;
  for (const suffix of ['', '-wal', '-shm']) {
    // A companion file that was never created has nothing to delete.
    attempt(
      () => {
        files.remove(`${driver.path}${suffix}`);
      },
      () => ({ kind: 'not-there' }) as const,
    );
  }
}

export type TasksBenchmarkDeps = {
  /** The app's real driver factory (expo-sqlite on a device, node:sqlite in the Jest test). */
  readonly openDriver: (fileName: string) => ClosableSqlDriver;
  readonly files: DatabaseFiles;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/**
 * PerfDebugDeps.openBenchmark: opens `fileName` (perf-bench.db, never the user's database) through
 * the app's own open path (WAL, synchronous FULL, the migrations), seeds it, and on close deletes
 * the file with its -wal and -shm companions, so every run starts from the same data.
 */
export function createTasksBenchmarkOpener(
  deps: TasksBenchmarkDeps,
): (fileName: string) => StorageBenchmarkTarget {
  return (fileName) => {
    const opened: ClosableSqlDriver[] = [];
    const database = openAppDatabase({
      openDriver: (name) => {
        const driver = deps.openDriver(name);
        opened.push(driver);
        return driver;
      },
      files: deps.files,
      fileName,
      migrations: MIGRATIONS,
      errorLog: deps.errorLog,
    });
    const tasks = createSqliteTaskRepository({
      driver: database.driver,
      clock: deps.clock,
      errorLog: deps.errorLog,
    });
    return {
      write: toggleTaskWrite(tasks, seedLargestRealisticTasks(tasks)),
      close: () => {
        for (const driver of opened) closeAndDelete(driver, deps.files);
      },
    };
  };
}
