#!/usr/bin/env node
// selftest.mjs: proves check-background-tasks.mjs passes the shipped templates and examples (the good
// case is assembled from them) and fails every planted bug, one bad-* case per rule.
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  {
    script: 'check-background-tasks.mjs',
    fixtures: '../tests/fixtures/check-background-tasks',
    args: (dir) => [dir],
  },
]);
