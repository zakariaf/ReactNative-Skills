#!/usr/bin/env node
// selftest.mjs: proves check-media.mjs against tests/fixtures/check-media. Every case is assembled from a
// minimal app (tests/bases/app), this skill's templates and its examples, each placed at the path its first
// line names, so the shipped templates and examples are proven to pass; every bad-* case plants one bug and
// must fail for its own rule; pass-* cases prove what must stay silent (tests, installed skills, the
// permission adapter, a video feature), the SKIP without an app config and NOT APPLICABLE.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-media.mjs', fixtures: '../tests/fixtures/check-media', args: (dir) => [dir] },
]);
