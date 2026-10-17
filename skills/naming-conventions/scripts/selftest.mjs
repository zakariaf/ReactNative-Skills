#!/usr/bin/env node
// selftest.mjs: proves check-file-names.mjs and check-code-names.mjs pass the assembled good app
// (tests/bases/app plus this skill's templates) and catch every planted bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-file-names.mjs', fixtures: '../tests/fixtures/check-file-names', args: (dir) => [dir] },
  { script: 'check-code-names.mjs', fixtures: '../tests/fixtures/check-code-names', args: (dir) => [dir] },
]);
