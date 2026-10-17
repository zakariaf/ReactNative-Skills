// scripts/hooks/install-git-hooks.ts
// device-only: covered by npm's "prepare" on every npm install and npm ci (the decision is tested in hook-install-plan.test.ts)
// npm "prepare": runs `lefthook install` only when this package is the git top level; anywhere else
// (no .git, or a folder inside a larger repository) it prints why it skipped and exits 0. The package
// root is found from this file's place (scripts/hooks/), and lefthook runs through `npx --no --` (the
// installed copy, never a download), so a failed install still fails `npm install`.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

import { planHookInstall, type GitTopLevel } from './hook-install-plan.ts';

const PACKAGE_ROOT = realpathSync(path.resolve(import.meta.dirname, '..', '..'));

function gitTopLevel(): GitTopLevel {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
  if (result.error !== undefined) {
    return { found: false, detail: `git did not start: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    return { found: false, detail: detail === '' ? `git exited ${String(result.status)}` : detail };
  }
  return { found: true, topLevel: realpathSync(result.stdout.trim()) };
}

function main(): number {
  const plan = planHookInstall(PACKAGE_ROOT, gitTopLevel());
  if (!plan.install) {
    console.log(`install-git-hooks: skipped: ${plan.reason}`);
    return 0;
  }
  const install = spawnSync('npx', ['--no', '--', 'lefthook', 'install'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
  });
  return install.status ?? 1;
}

process.exitCode = main();
