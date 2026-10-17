#!/usr/bin/env node
// selftest.mjs: proves both scripts against tests/fixtures/. The check-backup suite assembles each case
// from a minimal app (tests/bases/app), this skill's templates and its examples, each placed at the path
// its first line names, so the shipped templates and examples are proven to pass; every bad-* case
// plants one bug and must fail for its own rule; pass-v2-upgrade proves examples/backup-v2 passes too.
// The inspect-backup suite starts from the frozen backup-v1 fixture of the templates.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-backup.mjs', fixtures: '../tests/fixtures/check-backup', args: (dir) => [dir] },
  {
    script: 'inspect-backup.mjs',
    fixtures: '../tests/fixtures/inspect-backup',
    args: (dir) => [join(dir, 'backup-v1.json'), '--format', 'tasks.backup', '--schema', '1'],
  },
]);
