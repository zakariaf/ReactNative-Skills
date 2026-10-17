#!/usr/bin/env node
// selftest.mjs: proves check-greeting.mjs passes the good fixture and catches the planted bug.

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-greeting.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] }]);
