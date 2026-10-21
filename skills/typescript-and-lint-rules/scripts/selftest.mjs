#!/usr/bin/env node
// selftest.mjs: proves check-configs.mjs and check-source.mjs pass their good fixtures and catch
// every planted bug, and add-import-extensions.mjs rewrites, refuses and stays idempotent. Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
// check-configs cases start from the shipped templates (tests/bases/configs-app + templates/), so the
// self-test also proves the templates pass their own checker. check-source cases start from good/.

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-configs.mjs', fixtures: '../tests/fixtures/check-configs', args: (dir) => [dir] },
  { script: 'check-source.mjs', fixtures: '../tests/fixtures/check-source', args: (dir) => [dir] },
  { script: 'add-import-extensions.mjs', fixtures: '../tests/fixtures/add-import-extensions', args: (dir) => [dir] },
]);
