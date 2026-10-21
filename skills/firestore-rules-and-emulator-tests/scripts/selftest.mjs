#!/usr/bin/env node
// selftest.mjs: proves check-rules-tests.mjs passes the shipped templates (the suite is assembled
// from tests/bases/app plus templates/ placed at the repo path line 1 names) and catches every planted
// bug: one bad-* case per rule, pass-* cases for comments, a missing service, a moved contract and
// NOT APPLICABLE, error-* cases for bad input.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

const base = ['@tests/bases/app', { templates: true, firstLinePath: true }];

await runSelftest(import.meta.url, [
  { script: 'check-rules-tests.mjs', fixtures: '../tests/fixtures/check-rules-tests', args: (dir) => [dir], base },
]);
