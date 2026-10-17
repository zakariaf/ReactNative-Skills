#!/usr/bin/env node
// selftest.mjs: proves check-boundaries.mjs and check-layout.mjs pass the good fixtures (a Tasks app
// built from tests/bases/ plus this skill's own templates, and a small multi-package repo) and catch
// every planted bug. Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-boundaries.mjs', fixtures: '../tests/fixtures/check-boundaries', args: (dir) => [dir] },
  { script: 'check-boundaries.mjs', fixtures: '../tests/fixtures/check-boundaries-monorepo', args: (dir) => [dir] },
  { script: 'check-layout.mjs', fixtures: '../tests/fixtures/check-layout', args: (dir) => [dir] },
  { script: 'check-layout.mjs', fixtures: '../tests/fixtures/check-layout-monorepo', args: (dir) => [dir] },
]);
