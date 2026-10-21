#!/usr/bin/env node
// selftest.mjs: proves check-animations.mjs passes the good case (the shipped templates under a small
// Tasks app with a Lottie celebration and a Rive mascot), catches every planted bug (bad-*, exit 1),
// passes the Lottie-only and not-applicable cases and stops on bad input (error-*, exit 2), each
// printing its expected lines. The cases are entries of tests/fixtures/check-animations/CASES.json,
// overlays on the base SUITE.json declares.
// Run: node <this skill>/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-animations.mjs', fixtures: '../tests/fixtures/check-animations', args: (dir) => [dir] },
]);
