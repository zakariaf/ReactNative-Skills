#!/usr/bin/env node
// selftest.mjs: proves both checkers against planted bugs (overlay fixtures, assembled by check-lib).
// Each suite's base is tests/bases/app (package.json with zustand, tsconfig paths, an OS-mirror
// store) + this skill's templates at the paths their first lines name + the two examples, so the
// good case proves the shipped templates and examples pass every rule; SUITE.json also plants
// stores and reducers with bugs under .agents/skills/, skills/ and a vendored folder holding a
// SKILL.md, which must stay silent. Every bad-* case plants one bug and must fail with its rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-stores.mjs', fixtures: '../tests/fixtures/check-stores', args: (dir) => [dir] },
  { script: 'check-reducers.mjs', fixtures: '../tests/fixtures/check-reducers', args: (dir) => [dir] },
]);
