#!/usr/bin/env node
// selftest.mjs: proves check-motion passes a full Tasks app built on the shipped templates and a
// fresh adoption of the templates alone, and fails each planted bug for its own rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-motion.mjs', fixtures: '../tests/fixtures/check-motion', args: (dir) => [dir] },
  { script: 'check-motion.mjs', fixtures: '../tests/fixtures/check-motion-adopt', args: (dir) => [dir] },
]);
