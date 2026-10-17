#!/usr/bin/env node
// selftest.mjs: proves check-ads and check-ad-behaviour against planted bugs (overlay fixtures,
// assembled by check-lib). The base is tests/bases/app (package.json, tsconfig paths, the catalogs,
// and planted findings under .agents/skills/, skills/ and a vendored folder with a SKILL.md, which
// must stay silent) + this skill's templates and examples at the paths their first lines name, so
// good/ proves that the shipped templates and examples pass every rule; each bad-* case plants one
// bug for one rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-ads.mjs', fixtures: '../tests/fixtures/check-ads', args: (dir) => [dir] },
  { script: 'check-ad-behaviour.mjs', fixtures: '../tests/fixtures/check-ad-behaviour', args: (dir) => [dir] },
]);
