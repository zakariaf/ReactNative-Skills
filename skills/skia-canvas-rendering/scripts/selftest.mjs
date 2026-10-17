#!/usr/bin/env node
// selftest.mjs: proves both checkers pass the shipped templates and catch every planted bug.
// Each suite's base is this skill's templates (filled for the Tasks progress grid) plus
// tests/bases/app (stand-ins for files other skills own, and a live surface); every case is that
// tree plus one planted change (mutation.json). Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-canvas-code.mjs', fixtures: '../tests/fixtures/check-canvas-code', args: (dir) => [dir] },
  { script: 'check-canvas-files.mjs', fixtures: '../tests/fixtures/check-canvas-files', args: (dir) => [dir] },
]);
