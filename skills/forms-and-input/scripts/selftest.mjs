#!/usr/bin/env node
// selftest.mjs: proves check-forms.mjs passes the good fixture (the shipped templates over a small
// Tasks app) and catches every planted bug. Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-forms.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] },
]);
