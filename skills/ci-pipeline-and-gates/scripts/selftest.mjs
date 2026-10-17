#!/usr/bin/env node
// selftest.mjs: proves check-workflows.mjs and check-ci-lanes.mjs pass the shipped templates (every
// suite is assembled from tests/bases/app plus templates/ placed at the repo path line 1 names) and
// catch every planted bug: one bad-* case per rule, pass-* cases for SKIP lines and NOT APPLICABLE,
// error-* cases for bad input.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

const base = ['@tests/bases/app', { templates: true, firstLinePath: true }];

await runSelftest(import.meta.url, [
  { script: 'check-workflows.mjs', fixtures: '../tests/fixtures/check-workflows', args: (dir) => [dir], base },
  { script: 'check-ci-lanes.mjs', fixtures: '../tests/fixtures/check-ci-lanes', args: (dir) => [dir], base },
]);
