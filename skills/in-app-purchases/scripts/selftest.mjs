#!/usr/bin/env node
// selftest.mjs: proves both checkers against planted bugs (overlay fixtures, assembled by check-lib).
// Each suite's base is tests/bases/app (package.json, tsconfig paths, app.config.ts with the bare
// 'expo-iap' plugin, catalogs, the paywall test IDs, a debug sub-flow) + this skill's templates at the
// paths their first lines name (placeholders filled) + examples/purchase-root.tsx as the composition
// root, so the good case proves the shipped templates pass every rule. SUITE.json also plants
// purchase bugs under .agents/skills/, skills/ and a vendored folder holding a SKILL.md, which must
// stay silent. Every bad-* case plants one bug and must fail with its own rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-purchases.mjs', fixtures: '../tests/fixtures/check-purchases', args: (dir) => [dir] },
  { script: 'check-purchase-behaviour.mjs', fixtures: '../tests/fixtures/check-purchase-behaviour', args: (dir) => [dir] },
]);
