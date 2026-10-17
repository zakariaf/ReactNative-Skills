#!/usr/bin/env node
// selftest.mjs: proves check-game-host.mjs. The good case is a small app (tests/bases/app: one fixture
// game, the architecture contract) with this skill's templates and examples laid on it at the repo
// paths their first lines name, so the shipped host, registry, config, binding and Game screen must
// pass; every bad-* case plants one bug that must be reported under its rule. The probes run with
// --stand-ins (no node_modules in a fixture).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-game-host.mjs', fixtures: '../tests/fixtures/check-game-host', args: (dir) => [dir, '--stand-ins'] },
]);
