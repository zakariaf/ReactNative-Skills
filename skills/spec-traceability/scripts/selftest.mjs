#!/usr/bin/env node
// selftest.mjs: proves spec-lookup.mjs and check-spec-refs.mjs pass their good fixtures and catch
// every planted bug. Both suites assemble each case from the shipped spec templates plus a small Tasks
// app (tests/bases/app/), so the templates are proven to pass their own checker.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'spec-lookup.mjs', fixtures: '../tests/fixtures/spec-lookup', args: (dir) => [dir, '--list'] },
  { script: 'check-spec-refs.mjs', fixtures: '../tests/fixtures/check-spec-refs', args: (dir) => [dir] },
]);
