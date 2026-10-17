#!/usr/bin/env node
// selftest.mjs: proves check-startup passes an app built from the shipped templates and fails each
// planted bug for its own rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-startup.mjs', fixtures: '../tests/fixtures/check-startup', args: (dir) => [dir] },
]);
