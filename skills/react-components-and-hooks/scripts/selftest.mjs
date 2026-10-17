#!/usr/bin/env node
// selftest.mjs: proves check-react-rules.mjs passes the good fixture (the shipped templates over a
// small Tasks app) and catches every planted bug. Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-react-rules.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] },
]);
