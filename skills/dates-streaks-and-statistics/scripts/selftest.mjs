#!/usr/bin/env node
// selftest.mjs: proves both checkers. The good case of each suite is this skill's templates placed at
// the repo paths their first lines name, on a minimal app (tests/bases/app); every bad-* case plants
// one bug for one rule, pass-* cases print a SKIP or NOT APPLICABLE line, error-* cases bad input.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-calendar-code.mjs', fixtures: '../tests/fixtures/check-calendar-code', args: (dir) => [dir] },
  { script: 'check-streaks-and-stats.mjs', fixtures: '../tests/fixtures/check-streaks-and-stats', args: (dir) => [dir] },
]);
