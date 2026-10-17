#!/usr/bin/env node
// selftest.mjs: proves check-rtl.mjs passes the shipped templates laid over a small Tasks app and
// catches every planted bug (tests/fixtures/check-rtl, overlay cases on tests/bases/app).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-rtl.mjs', fixtures: '../tests/fixtures/check-rtl', args: (dir) => [dir] },
]);
