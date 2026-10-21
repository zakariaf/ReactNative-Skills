#!/usr/bin/env node
// selftest.mjs: proves check-functions.mjs against planted-bug fixtures. Every case assembles from this
// skill's templates (so the shipped templates are the good case) plus planted decoys under installed
// and vendored skills, then applies the case's ops from tests/fixtures/check-functions/CASES.json.
//   node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-functions.mjs', fixtures: '../tests/fixtures/check-functions', args: (dir) => [dir] }]);
