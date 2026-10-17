#!/usr/bin/env node
// selftest.mjs: proves every checker of this skill passes its good fixture and catches each planted bug.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

const repo = (dir) => [dir];

await runSelftest(import.meta.url, [
  { script: 'check-catalogs.mjs', fixtures: '../tests/fixtures/check-catalogs', args: repo },
  // The shipped template catalogs (en, ar) pass their own checker.
  { script: 'check-catalogs.mjs', fixtures: '../tests/fixtures/check-catalogs-templates', args: repo },
  // When multi-package: package catalogs with a key prefix (contracts/i18n.json "catalogs").
  { script: 'check-catalogs.mjs', fixtures: '../tests/fixtures/check-catalogs-packages', args: repo },
  // The shipped templates plus a small app: the good case proves the templates pass the code rules.
  { script: 'check-i18n-code.mjs', fixtures: '../tests/fixtures/check-i18n-code', args: repo },
  { script: 'check-i18n-code.mjs', fixtures: '../tests/fixtures/check-i18n-code-packages', args: repo },
  // When multi-package: the Expo app in a workspace (apps/mobile), checked with --app-dir.
  { script: 'check-i18n-code.mjs', fixtures: '../tests/fixtures/check-i18n-code-workspace', args: (dir) => [dir, '--app-dir', 'apps/mobile'] },
  { script: 'sync-copy.mjs', fixtures: '../tests/fixtures/sync-copy', args: (dir) => ['check', dir, '--screen', 'tasks'] },
]);
