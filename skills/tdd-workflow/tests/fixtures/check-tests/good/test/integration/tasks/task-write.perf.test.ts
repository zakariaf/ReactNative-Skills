// test/integration/tasks/task-write.perf.test.ts: a perf budget test may time real work with
// performance from node:perf_hooks (jest-expo mocks the global one).
import { performance } from 'node:perf_hooks';

const P95_BUDGET_MS = 5;

describe('taskWrite', () => {
  it('keeps the p95 write time under the budget', () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const start = performance.now();
      JSON.stringify({ i });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.ceil(samples.length * 0.95) - 1]).toBeLessThan(P95_BUDGET_MS);
  });
});
