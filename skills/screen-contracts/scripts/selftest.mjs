#!/usr/bin/env node
// selftest.mjs: proves check-screens.mjs and list-screen.mjs pass the skill's own templates (laid over
// a small Tasks app, so the shipped contract, screens, dialog and tests are the good case) and fail
// every planted bug for its own rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest } from './check-lib.mjs';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));
const CATALOGS = 'src/i18n/catalogs';

/** The base app's catalogs with the templates' keys merged in, keys sorted (what an app that adopts the templates holds). */
function writeMergedCatalogs(dir) {
  mkdirSync(join(dir, CATALOGS), { recursive: true });
  for (const language of ['en', 'ar']) {
    const read = (root) => JSON.parse(readFileSync(join(SKILL, root, CATALOGS, `${language}.json`), 'utf8'));
    const merged = { ...read('tests/bases/app'), ...read('templates') };
    const sorted = Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]]));
    writeFileSync(join(dir, CATALOGS, `${language}.json`), `${JSON.stringify(sorted, null, 2)}\n`);
  }
}

const APP = [
  '@tests/bases/app',
  { templates: true, firstLinePath: true, exclude: [`${CATALOGS}/*.json`] },
  { build: async (dir) => writeMergedCatalogs(dir) },
];

await runSelftest(import.meta.url, [
  { script: 'check-screens.mjs', fixtures: '../tests/fixtures/check-screens', args: (dir) => [dir, '--all'], base: APP },
  { script: 'list-screen.mjs', fixtures: '../tests/fixtures/list-screen', args: (dir) => [dir, '--screen', 'lists'], base: APP },
]);
