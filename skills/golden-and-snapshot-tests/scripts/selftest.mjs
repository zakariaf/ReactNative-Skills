#!/usr/bin/env node
// selftest.mjs: proves each checker of this skill passes its good fixture (assembled from the shipped
// templates) and catches every planted bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-goldens.mjs', fixtures: '../tests/fixtures/check-goldens', args: (dir) => [dir] },
  { script: 'check-golden-changes.mjs', fixtures: '../tests/fixtures/check-golden-changes', args: (dir) => [dir, '--log', join(dir, 'history.log')] },
]);
