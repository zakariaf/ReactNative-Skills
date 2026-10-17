#!/usr/bin/env node
// selftest.mjs: proves check-gate-wiring.mjs and check-bypasses.mjs pass their good fixtures and
// catch every planted bug. The wiring suite is assembled from this skill's own templates (so the
// shipped templates pass their own checker), the merged Claude Code settings, the canonical root
// configs of tests/bases/app, and a package.json holding exactly templates/package-scripts.json.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest } from './check-lib.mjs';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..');
const RENAMES = { 'dot-npmrc': '.npmrc', 'dot-prettierrc.json': '.prettierrc.json' };

function writePackageJson(dir) {
  const scripts = JSON.parse(readFileSync(join(SKILL, 'templates', 'package-scripts.json'), 'utf8'));
  const manifest = { name: 'tasks-app', version: '1.0.0', private: true, main: 'expo-router/entry', scripts };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

await runSelftest(import.meta.url, [
  {
    script: 'check-gate-wiring.mjs',
    fixtures: '../tests/fixtures/check-gate-wiring',
    args: (dir) => [dir],
    base: [
      { templates: true, firstLinePath: true },
      { from: '@skill/assets/claude-settings.json', to: '.claude/settings.json' },
      '@tests/bases/app',
      { build: async (dir) => writePackageJson(dir) },
    ],
    renames: RENAMES,
  },
  {
    script: 'check-bypasses.mjs',
    fixtures: '../tests/fixtures/check-bypasses',
    args: (dir) => [dir, '--today', '2026-10-03'],
    base: [
      { from: '@skill/templates/lefthook.yml', to: 'lefthook.yml' },
      { from: '@skill/templates/quality-gates.json', to: 'quality-gates.json' },
      { from: '@skill/assets/claude-settings.json', to: '.claude/settings.json' },
      'good',
    ],
    renames: RENAMES,
  },
]);
