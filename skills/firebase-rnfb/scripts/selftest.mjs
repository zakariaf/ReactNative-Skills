#!/usr/bin/env node
// selftest.mjs: proves check-rnfb.mjs against planted bugs. The suite's base is tests/bases/app (a
// Tasks app's package.json, tsconfig paths, app.config.ts, .gitignore and a feature hook) plus this
// skill's templates at the paths their first lines name, so the good case proves the shipped
// templates pass every rule; each bad-* case in CASES.json plants one bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-rnfb.mjs', fixtures: '../tests/fixtures/check-rnfb', args: (dir) => [dir] }]);
