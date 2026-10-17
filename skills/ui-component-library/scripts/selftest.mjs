#!/usr/bin/env node
// selftest.mjs: proves check-components.mjs and write-component-specs.mjs pass their good cases
// (assembled from this skill's templates over a small base app, so the shipped templates pass too)
// and fail every planted bug for its own rule.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest } from './check-lib.mjs';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The app's token file as an app that adopted this skill has it: the canonical demo token file
 * (synced from design-system-structure) with this skill's demo components block merged in. The
 * canonical file now ships the same block; merging keeps the fixtures on this skill's own values.
 */
function writeAppTokens(dir) {
  const tokens = JSON.parse(readFileSync(join(SKILL, 'tests/bases/app/design/tokens.json'), 'utf8'));
  const { components } = JSON.parse(readFileSync(join(SKILL, 'assets/components-block.json'), 'utf8'));
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design/tokens.json'), `${JSON.stringify({ ...tokens, components }, null, 2)}\n`);
}

const APP = [{ templates: true, firstLinePath: true }, '@tests/bases/app', { build: async (dir) => writeAppTokens(dir) }];

await runSelftest(import.meta.url, [
  { script: 'check-components.mjs', fixtures: '../tests/fixtures/check-components', args: (dir) => [dir], base: APP },
  { script: 'write-component-specs.mjs', fixtures: '../tests/fixtures/write-component-specs', args: (dir) => [dir, '--check'], base: APP },
  // A small token file proves the derivation itself: references resolved, browser borders floored
  // (2.5 -> 2, 1.5 -> 1) only when asked, sub-pixel borders, rings and strokes kept, overrides applied.
  { script: 'write-component-specs.mjs', fixtures: '../tests/fixtures/write-component-specs-rule', args: (dir) => [dir, '--check'] },
]);
