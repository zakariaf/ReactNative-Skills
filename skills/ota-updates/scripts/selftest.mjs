#!/usr/bin/env node
// selftest.mjs: proves check-ota against planted bugs (overlay fixtures, assembled by check-lib).
// The base is tests/bases/app (package.json, app.config.ts, eas.json, a GitHub workflow and an EAS
// workflow that publish correctly, and planted findings under .agents/skills/, skills/ and a vendored
// folder with a SKILL.md, which must stay silent) + this skill's templates at the paths their first
// lines name, so good/ proves the shipped templates pass every rule; each bad-* case plants one bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-ota.mjs', fixtures: '../tests/fixtures/check-ota', args: (dir) => [dir] },
]);
