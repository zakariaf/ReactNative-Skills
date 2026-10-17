// test/perf/storage-write.perf.test.ts
// The Jest guard of the storage-write budget: the app's real per-change write on node:sqlite through
// the same opener and seed as the device benchmark (src/data/perf/tasks-benchmark.ts: the app's own
// open path, WAL + synchronous FULL, 1,000 tasks), 300 timed writes after 20 warm-ups. Replace the
// seed and the write there, not here. It catches a missing transaction, a write per row or a
// serializer that grows with the data; device I/O is the debug menu's job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The React Native Jest preset replaces the global performance.now with a 1 ms Date.now mock.
import { performance } from 'node:perf_hooks';

import { runStorageBenchmark } from '@/core/perf/write-times';
import { createTasksBenchmarkOpener } from '@/data/perf/tasks-benchmark';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createNodeDatabaseFiles } from '@test/sqlite/node-database-files';
import { createNodeSqliteSqlDriver } from '@test/sqlite/node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from '@test/sqlite/temp-database-folder';

const DEFAULT_BUDGET_MS = 5;

/** perf.saveWriteP95MsMax from quality-gates.json, the one place budgets live. */
function writeBudgetMs(): number {
  const gates: unknown = JSON.parse(
    readFileSync(join(process.cwd(), 'quality-gates.json'), 'utf8'),
  );
  const perf = (gates as { perf?: { saveWriteP95MsMax?: unknown } }).perf;
  return typeof perf?.saveWriteP95MsMax === 'number' ? perf.saveWriteP95MsMax : DEFAULT_BUDGET_MS;
}

describe('the per-change storage write', () => {
  it('stays under the p95 budget with the largest realistic data', () => {
    const folder = makeTempDatabaseFolder();
    try {
      const open = createTasksBenchmarkOpener({
        openDriver: (name) =>
          createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
        files: createNodeDatabaseFiles(),
        clock: { nowMs: () => 1_790_000_000_000 },
        errorLog: createFakeErrorLog(),
      });
      const target = open('perf-bench.db');
      try {
        const times = runStorageBenchmark({ write: target.write, now: () => performance.now() });
        // A failure prints the measured p95 against the budget; nothing is logged on a pass.
        expect(times.writes).toBe(300);
        expect(times.p95).toBeLessThan(writeBudgetMs());
      } finally {
        target.close();
      }
    } finally {
      // A failing write must not leak the scratch database.
      folder.remove();
    }
  });
});
