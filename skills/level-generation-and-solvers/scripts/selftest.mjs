#!/usr/bin/env node
// selftest.mjs: proves check-levels.mjs. The good repo is this skill's templates filled as the game
// "lights-out" (the kit, the generator, the contract, the template game's levels with their
// generated packs and golden snapshot, and the prerequisite copies) on a minimal app
// (tests/bases/app). tests/fixtures/check-levels/ plants one bug per rule. A second suite
// (tests/fixtures/check-levels-score) makes the same game score-rated: its base step rewrites
// rate() and the contract and regenerates the packs, so they carry threshold arrays that Prettier
// writes on one line; its bad cases plant a pack in plain JSON.stringify layout and a hand edit.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMutation, assembleSuiteCases, makeTempDir, readSuiteSpec, removeTempDir, runSelftest } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { levelLayout } from './lib/level-layout.mjs';
import { writePacks } from './lib/level-run.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const LEVELS = 'src/games/lights-out/levels';
const CHANGED = ['contracts/levels.json', `${LEVELS}/lights-out-level-plan.ts`, `${LEVELS}/pack-1.json`, `${LEVELS}/pack-2.json`, `${LEVELS}/pack-3.json`];

/**
 * The score suite's base layer: the check-levels good repo made score-rated (score.json) with its
 * packs generated as generate-levels.ts would; only the files that differ are laid over the base.
 */
async function scoreRated(dir) {
  const tmp = makeTempDir('levels-score-');
  try {
    const suiteDir = join(fixtures, 'check-levels');
    const [good] = assembleSuiteCases({ suiteDir, into: tmp, spec: readSuiteSpec(suiteDir), only: (name) => name === 'good' });
    if (!good?.dir) throw new Error(`check-levels/good did not assemble: ${good?.error ?? 'missing'}`);
    applyMutation(good.dir, JSON.parse(readFileSync(join(fixtures, 'check-levels-score', 'score.json'), 'utf8')), 'score.json');
    await writePacks(levelLayout(good.dir), enableAppImports(good.dir), 'lights-out');
    for (const rel of CHANGED) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(join(good.dir, rel), join(dir, rel));
    }
  } finally {
    removeTempDir(tmp);
  }
}

const PLACEHOLDERS = { __GAME_ID__: 'lights-out', __GAME_PASCAL__: 'LightsOut', __GAME_CONST__: 'LIGHTS_OUT' };

await runSelftest(import.meta.url, [
  { script: 'check-levels.mjs', fixtures: '../tests/fixtures/check-levels', args: (dir) => [dir] },
  {
    script: 'check-levels.mjs',
    fixtures: '../tests/fixtures/check-levels-score',
    args: (dir) => [dir],
    base: ['@tests/bases/app', { templates: true, firstLinePath: true, fill: PLACEHOLDERS }, { build: scoreRated }],
    renames: { 'dot-prettierrc.json': '.prettierrc.json' },
  },
]);
