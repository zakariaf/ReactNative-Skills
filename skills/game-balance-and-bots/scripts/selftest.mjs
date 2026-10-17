#!/usr/bin/env node
// selftest.mjs: proves check-balance.mjs. The good case is this skill's templates (filled as the game
// "lights-out") plus both worked examples (pig, arena-chase) with their real sim reports on a minimal
// app (tests/bases/app), so the shipped templates and examples must pass; every bad-* case plants one
// bug that must be reported under its rule. Rebuild the cases with node tests/build-fixtures.mjs.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-balance.mjs', fixtures: '../tests/fixtures/check-balance', args: (dir) => [dir] },
]);
