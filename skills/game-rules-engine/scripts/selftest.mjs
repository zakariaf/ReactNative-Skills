#!/usr/bin/env node
// selftest.mjs: proves check-rules-engine.mjs. The good case is this skill's templates (filled as the
// game "lights-out") plus the module assembly example on a minimal app (tests/bases/app), so the
// shipped templates must pass; every bad-* case plants one bug that must be reported under its rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-rules-engine.mjs', fixtures: '../tests/fixtures/check-rules-engine', args: (dir) => [dir] },
]);
