#!/usr/bin/env node
// selftest.mjs: proves check-test-hooks. The good case is this skill's templates placed at the repo
// paths their first lines name, on a minimal app (tests/bases/app) with the startup and root stack of
// examples/ wired in; every bad-* case plants one bug for one rule, pass-* cases print a SKIP, a note
// or NOT APPLICABLE, error-* cases bad input.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-test-hooks.mjs', fixtures: '../tests/fixtures/check-test-hooks', args: (dir) => [dir] },
]);
