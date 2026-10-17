#!/usr/bin/env node
// selftest.mjs: proves each checker of this skill passes its good fixture and catches every planted bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-test-setup.mjs', fixtures: '../tests/fixtures/check-test-setup', args: (dir) => [dir] },
  { script: 'check-test-code.mjs', fixtures: '../tests/fixtures/check-test-code', args: (dir) => [dir] },
  { script: 'check-mutation-report.mjs', fixtures: '../tests/fixtures/check-mutation-report', args: (dir) => [dir] },
]);
