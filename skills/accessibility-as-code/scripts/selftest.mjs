#!/usr/bin/env node
// selftest.mjs: proves every checker of this skill passes its good fixture (assembled from the
// shipped templates plus a small neutral app) and catches each planted bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-a11y-code.mjs', fixtures: '../tests/fixtures/check-a11y-code', args: (dir) => [dir] },
  { script: 'check-contrast.mjs', fixtures: '../tests/fixtures/check-contrast', args: (dir) => [dir] },
]);
