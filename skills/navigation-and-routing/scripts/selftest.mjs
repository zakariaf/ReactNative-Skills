#!/usr/bin/env node
// selftest.mjs: proves check-navigation.mjs passes the good cases and fails every planted bug for its
// own rule. Two suites: an Expo Router app (tests/bases/app with this skill's templates, so the shipped
// templates pass their own checker) and a React Navigation 7 static app (this skill's
// examples/react-navigation over tests/bases/react-navigation). The decoys under .agents/skills/,
// skills/ and a vendored skill folder stay silent.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-navigation.mjs', fixtures: '../tests/fixtures/expo-router', args: (dir) => [dir] },
  { script: 'check-navigation.mjs', fixtures: '../tests/fixtures/react-navigation', args: (dir) => [dir] },
]);
