#!/usr/bin/env node
// selftest.mjs: proves both checkers pass the shipped templates (the good case of each suite is the
// templates on a minimal app) and catch every planted bug (one bad-* case per rule).
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-determinism.mjs', fixtures: '../tests/fixtures/check-determinism', args: (dir) => [dir] },
  { script: 'check-golden-vectors.mjs', fixtures: '../tests/fixtures/check-golden-vectors', args: (dir) => [dir] },
]);
