#!/usr/bin/env node
// selftest.mjs: proves check-crash-reporting.mjs against tests/fixtures/. The suite assembles each
// case from tests/bases/app, this skill's templates and its examples (each placed at the path its
// first line names), so the shipped templates and examples are proven to pass the checker; every
// bad-* case plants one bug and must fail for its own rule.
// Usage: node selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-crash-reporting.mjs', fixtures: '../tests/fixtures/check-crash-reporting', args: (dir) => [dir] },
]);
