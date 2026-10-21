#!/usr/bin/env node
// selftest.mjs: proves check-revenuecat.mjs against planted bugs (overlay fixtures, assembled by
// check-lib). The suite's base is tests/bases/app (package.json with react-native-purchases, the app
// config, catalogs, a paywall helper, a server quota check) + every template of this skill at the
// path its first line names (placeholders filled), so the good case proves the shipped templates
// pass every rule. SUITE.json also plants bugs under .agents/skills/, skills/ and a vendored folder
// holding a SKILL.md, which must stay silent. Every bad-* case plants one bug and fails with its rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-revenuecat.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] }]);
