#!/usr/bin/env node
// selftest.mjs: proves check-design-system.mjs, check-raw-values.mjs and write-palette.mjs pass their
// good cases (assembled from this skill's templates, so the shipped templates pass too) and fail
// every planted bug for its own rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-design-system.mjs', fixtures: '../tests/fixtures/check-design-system', args: (dir) => [dir] },
  { script: 'check-raw-values.mjs', fixtures: '../tests/fixtures/check-raw-values', args: (dir) => [dir] },
  { script: 'write-palette.mjs', fixtures: '../tests/fixtures/write-palette', args: (dir) => [dir, '--dry-run'] },
]);
