// lib/git-fixture.mjs: builds small throwaway git repositories for the self-test (check-test-edits'
// --range and --staged modes need a real repository; a skill cannot commit a .git folder). Commits use a
// fixed author, committer and date and ignore the user's git config, so every run yields the same SHAs.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FIXED_DATE = '2026-10-01T09:00:00Z';
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'author@fixture.invalid',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'author@fixture.invalid',
};

/** Runs git in `dir`; throws with git's own message when it fails (a fixture bug, never a check result). */
export function git(dir, args, extraEnv = {}) {
  const result = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.no-hooks', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8', env: { ...ENV, ...extraEnv } });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}

export function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
}

/** Writes (string) or deletes (null) each file, relative to `dir`. */
export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    if (content === null) rmSync(abs, { force: true });
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
}

/** Applies the files, stages everything and commits with `message`; minute `n` keeps the dates ordered. */
export function commit(dir, message, files, n = 0) {
  writeFiles(dir, files);
  git(dir, ['add', '-A']);
  const date = new Date(Date.parse(FIXED_DATE) + n * 60_000).toISOString();
  git(dir, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/** Writes the files and stages them without committing (the --staged mode reads the index). */
export function stage(dir, files) {
  writeFiles(dir, files);
  git(dir, ['add', '-A']);
}

/** The log check-test-edits reads with --log, for the commits in `range`. */
export function captureLog(dir, range) {
  return git(dir, ['log', '--reverse', '-M', '-p', '--no-color', '--format===> commit %H%n%B%n==> diff', range]);
}
