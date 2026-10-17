#!/usr/bin/env node
// selftest.mjs: proves both scripts of this skill against tests/fixtures/ (overlay suites):
//   check-deps-policy.mjs passes the shipped templates (seed policy, .npmrc, gate scripts) over a
//   single-app base and over an npm-workspaces base, and fails each planted policy break;
//   plan-dependency.mjs prints the commands a passing plan needs (pass-*: npx expo install
//   <pkg>@<table spec>, companions, peers and overrides) and fails each forbidden request.
// Each suite's SUITE.json names its base (tests/bases/<name> + templates/); a case holds EXPECT.txt
// and its planted change (mutation.json, DELETE.txt, overlay files, ARGS.txt).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

const TODAY = '2026-10-03';

await runSelftest(import.meta.url, [
  { script: 'check-deps-policy.mjs', fixtures: '../tests/fixtures/check-deps-policy', args: (dir) => [dir, '--today', TODAY] },
  { script: 'check-deps-policy.mjs', fixtures: '../tests/fixtures/check-deps-policy-monorepo', args: (dir) => [dir, '--today', TODAY] },
  { script: 'plan-dependency.mjs', fixtures: '../tests/fixtures/plan-dependency', args: (dir) => ['expo-haptics', dir, '--today', TODAY] },
  { script: 'plan-dependency.mjs', fixtures: '../tests/fixtures/plan-dependency-monorepo', args: (dir) => ['expo-haptics', dir, '--today', TODAY] },
]);
