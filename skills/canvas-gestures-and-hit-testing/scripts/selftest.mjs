#!/usr/bin/env node
// selftest.mjs: proves check-canvas-input.mjs passes the shipped templates and examples and catches
// every planted bug. The suite's base is this skill's templates (filled for the Tasks progress
// grid), its examples (each placed at the repo path its first line names) and tests/bases/app
// (stand-ins for files other skills own); every case is that tree plus one planted change.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-canvas-input.mjs', fixtures: '../tests/fixtures/check-canvas-input', args: (dir) => [dir] },
]);
