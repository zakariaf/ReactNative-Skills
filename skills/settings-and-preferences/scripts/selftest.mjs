#!/usr/bin/env node
// selftest.mjs: proves check-settings.mjs passes the good case (assembled from this skill's
// templates, so the shipped templates pass their own checker) and fails every planted bug for its
// own rule; the decoys under .agents/skills/, skills/ and a vendored skill folder stay silent.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-settings.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] },
]);
