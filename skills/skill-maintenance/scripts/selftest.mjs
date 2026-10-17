#!/usr/bin/env node
// selftest.mjs: proves every script of this skill passes its good case and catches every planted bug.
// Each suite in tests/fixtures/ is an overlay suite: a SUITE.json base, case folders that hold only
// EXPECT.txt, and what each case changes (its ops and arguments) in the suite's CASES.json. The two scaffold suites start
// from a fresh new-skill.mjs run (a normal skill and a run-* runbook), so the shipped scaffold must pass
// the validator as written and must fail check-skill until its placeholders are filled.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError, runSelftest } from './check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A base layer: runs new-skill.mjs into the folder, once per suite. */
const scaffoldLayer = {
  build: async (dir) => {
    for (const args of [['store-listing-texts'], ['run-list-export', '--runbook']]) {
      const result = spawnSync(process.execPath, [join(HERE, 'new-skill.mjs'), ...args, '--skills-root', dir], { encoding: 'utf8' });
      if (result.status !== 0) throw new UsageError(`new-skill.mjs ${args.join(' ')} exited ${result.status}: ${(result.stdout + result.stderr).trim().split('\n').pop()}`, 'Fix new-skill.mjs or the scaffold in assets/scaffold/.');
    }
  },
};

await runSelftest(import.meta.url, [
  { script: 'validate-skill.mjs', fixtures: '../tests/fixtures/validate-skill', args: (dir) => [join(dir, 'skills'), '--shared', join(dir, 'shared')] },
  { script: 'check-skill.mjs', fixtures: '../tests/fixtures/check-skill', args: (dir) => [join(dir, 'skills', 'task-titles')] },
  { script: 'check-skill-set.mjs', fixtures: '../tests/fixtures/check-skill-set', args: (dir) => [join(dir, 'skills')] },
  { script: 'check-routing.mjs', fixtures: '../tests/fixtures/check-routing', args: (dir) => [join(dir, 'skills'), '--evals', join(dir, 'evals.json')] },
  { script: 'new-skill.mjs', fixtures: '../tests/fixtures/new-skill', args: (dir) => ['store-listing-texts', '--skills-root', join(dir, 'skills')] },
  { script: 'validate-skill.mjs', fixtures: '../tests/fixtures/scaffold-valid', base: [scaffoldLayer], args: (dir) => [dir] },
  { script: 'check-skill.mjs', fixtures: '../tests/fixtures/scaffold-check', base: [scaffoldLayer], args: (dir) => [join(dir, 'store-listing-texts')] },
]);
