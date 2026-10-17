#!/usr/bin/env node
// selftest.mjs: proves check-permissions against tests/fixtures/. Every case is assembled from the base
// app (tests/bases/app), this skill's templates and its examples, each placed at the path its first
// line names, so the shipped templates and the Tasks camera example are proven to pass the checker;
// every bad-* case plants the bug of one rule and must fail for that rule.
// Usage: node selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-permissions.mjs', fixtures: '../tests/fixtures/check-permissions', args: (dir) => [dir] },
]);
