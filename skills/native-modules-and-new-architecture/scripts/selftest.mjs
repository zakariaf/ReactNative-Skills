#!/usr/bin/env node
// selftest.mjs: proves both checkers against tests/fixtures/. check-native-modules assembles every case
// from the base app (tests/bases/app), this skill's templates (each at the path its first line
// names: the time-change module and its port, adapter and fake) and the Turbo Module example (placed
// at modules/task-checksum), so the shipped templates and example are proven to pass; every bad-* case
// plants one bug and must fail for that rule. check-native-libraries assembles a small app with an
// installed node_modules tree (stored as fixture-node-modules, renamed at assembly).
// Usage: node selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-native-modules.mjs', fixtures: '../tests/fixtures/check-native-modules', args: (dir) => [dir] },
  { script: 'check-native-libraries.mjs', fixtures: '../tests/fixtures/check-native-libraries', args: (dir) => [dir, '--today', '2026-10-14'] },
]);
