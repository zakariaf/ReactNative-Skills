#!/usr/bin/env node
// selftest.mjs: proves both checkers against tests/fixtures/ (overlay cases on tests/bases/app plus
// the shipped templates): good/ passes, every bad-* case fails for its own rule, pass-* cases print
// their NOT APPLICABLE line or stay silent on planted findings in installed skills, error-* exit 2.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-reminder-code.mjs', fixtures: '../tests/fixtures/check-reminder-code', args: (dir) => [dir] },
  { script: 'check-reminder-logic.mjs', fixtures: '../tests/fixtures/check-reminder-logic', args: (dir) => [dir] },
]);
