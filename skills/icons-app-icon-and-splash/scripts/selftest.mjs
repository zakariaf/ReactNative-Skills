#!/usr/bin/env node
// selftest.mjs: proves check-icons.mjs and check-app-art.mjs pass their good cases (assembled from this
// skill's templates, so the shipped templates pass their own checkers) and fail every planted bug for
// its own rule. check-app-art's images are generated at run time (SUITE.json png ops), never committed.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-icons.mjs', fixtures: '../tests/fixtures/check-icons', args: (dir) => [dir] },
  { script: 'check-app-art.mjs', fixtures: '../tests/fixtures/check-app-art', args: (dir) => [dir] },
]);
