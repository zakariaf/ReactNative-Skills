#!/usr/bin/env node
// selftest.mjs: proves check-rules.mjs passes good/, catches every planted bug (bad-*, exit 1) and
// stops on bad input (error-*, exit 2), each printing its EXPECT.txt lines. The cases are overlays on
// good/ (tests/fixtures/SUITE.json): each holds only EXPECT.txt and what it changes.
// Run: node <this skill>/scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-rules.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] }]);
