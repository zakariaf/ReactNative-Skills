#!/usr/bin/env node
// selftest.mjs: proves every checker of this skill passes its good fixture and catches each planted
// bug. eas-config assembles the shipped templates (eas.json filled, scripts/eas/) over the Tasks base
// app with decoys under .agents/skills/, skills/ and a vendored SKILL.md folder that must stay silent,
// so the templates are the good case; eas-build checks build records against a base app, its eas.json
// and the fingerprints a preflight wrote; eas-build-tags puts that app at apps/mobile and reads the
// upload tags from a throwaway git repo made per case from its TAGS.txt (a skill cannot commit .git).
//   node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

const COMMIT = '3f2a9c1d4b5e6f708192a3b4c5d6e7f809a1b2c3';

/** git init in the assembled case, one empty commit, a lightweight tag per TAGS.txt line. */
function tagRepo(dir) {
  const file = join(dir, 'TAGS.txt');
  if (!existsSync(file)) return;
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'selftest');
  for (const tag of readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)) git('tag', tag);
}

await runSelftest(import.meta.url, [
  { script: 'check-eas-config.mjs', fixtures: '../tests/fixtures/eas-config', args: (dir) => [dir] },
  { script: 'check-eas-build.mjs', fixtures: '../tests/fixtures/eas-build', args: (dir) => [dir, '--build', 'dist/eas/build-ios.json', '--commit', COMMIT, '--previous', '41'] },
  {
    script: 'check-eas-build.mjs',
    fixtures: '../tests/fixtures/eas-build-tags',
    args: (dir) => {
      tagRepo(dir);
      return [dir, '--app-dir', 'apps/mobile', '--build', 'apps/mobile/dist/eas/build-ios.json', '--commit', COMMIT];
    },
  },
]);
