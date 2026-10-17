#!/usr/bin/env node
// selftest.mjs: proves check-realtime-loop.mjs passes the shipped templates and examples (good/) and
// catches every planted bug (bad-*), and that a turn-based-only app is NOT APPLICABLE.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-realtime-loop.mjs', fixtures: '../tests/fixtures/check-realtime-loop', args: (dir) => [dir] },
]);
