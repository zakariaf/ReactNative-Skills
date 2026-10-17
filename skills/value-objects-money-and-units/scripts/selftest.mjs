#!/usr/bin/env node
// selftest.mjs: proves both checkers. The good case of each suite is this skill's templates placed at
// the repo paths their first lines name, on a minimal app (tests/bases/app); check-value-code adds the
// examples, so the shapes the skill teaches pass its own scanner. Every bad-* case plants one bug for
// one rule, pass-* cases print an allowed outcome (an allow marker, NOT APPLICABLE, silenced folders),
// error-* cases give bad input.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-value-code.mjs', fixtures: '../tests/fixtures/check-value-code', args: (dir) => [dir] },
  { script: 'check-value-core.mjs', fixtures: '../tests/fixtures/check-value-core', args: (dir) => [dir] },
]);
