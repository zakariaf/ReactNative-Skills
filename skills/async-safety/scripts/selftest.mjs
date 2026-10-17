#!/usr/bin/env node
// selftest.mjs: proves check-async-safety against tests/fixtures/. The suite assembles every case from
// the base app (tests/bases/app), this skill's templates and its examples, each placed at the path its
// first line names, so the shipped templates and examples are proven to pass the checker; every bad-*
// case plants bugs of one rule and must fail for that rule.
// Usage: node selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-async-safety.mjs', fixtures: '../tests/fixtures/check-async-safety', args: (dir) => [dir] },
]);
