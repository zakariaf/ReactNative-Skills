#!/usr/bin/env node
// selftest.mjs: proves check-adaptive-layout.mjs passes the shipped templates laid over a small Tasks
// app (tests/bases/app) and catches every planted bug (tests/fixtures/check-adaptive-layout).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-adaptive-layout.mjs', fixtures: '../tests/fixtures/check-adaptive-layout', args: (dir) => [dir] },
]);
