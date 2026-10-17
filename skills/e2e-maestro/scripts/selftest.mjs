#!/usr/bin/env node
// selftest.mjs: proves each checker of this skill passes its good case (the skill's own templates on a
// small app base) and catches every planted bug of tests/fixtures/ (overlay cases).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-flows.mjs', fixtures: '../tests/fixtures/check-flows', args: (dir) => [dir, '--today', '2026-10-14'] },
  { script: 'check-e2e-setup.mjs', fixtures: '../tests/fixtures/check-e2e-setup', args: (dir) => [dir] },
  { script: 'check-e2e-report.mjs', fixtures: '../tests/fixtures/check-e2e-report', args: (dir) => [dir, '--platform', 'ios'] },
]);
