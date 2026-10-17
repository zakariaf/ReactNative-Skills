#!/usr/bin/env node
// selftest.mjs: proves both checkers against tests/fixtures/. Each suite assembles its cases from the
// shared base app (tests/bases/app), this skill's templates and its examples (placed at the paths
// their first lines name), so the shipped templates and examples are proven to pass the checkers;
// every bad-* case plants one bug and must fail for its own rule.
// Usage: node selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-error-spine.mjs', fixtures: '../tests/fixtures/check-error-spine', args: (dir) => [dir] },
  { script: 'check-error-net.mjs', fixtures: '../tests/fixtures/check-error-net', args: (dir) => [dir] },
]);
