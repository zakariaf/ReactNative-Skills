#!/usr/bin/env node
// selftest.mjs: proves check-commits.mjs (log mode on captured `git log` output, message mode, and the
// shared commit-message sample list that the commit-msg hook's Jest test also runs), check-tags.mjs
// and check-report.mjs (release, slice and request form, and the two change blocks; the report suites
// assemble from the shipped examples, so the examples are proven too) pass their good fixtures and
// catch every planted bug. The check-commits-git suite builds throwaway git repositories (fixed author
// and dates, no user config) because --staged and --range read a real repository and a skill cannot
// commit a .git folder.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'author@fixture.invalid',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'author@fixture.invalid',
  GIT_AUTHOR_DATE: '2026-10-01T09:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-01T09:00:00Z',
};

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.no-hooks', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8', env: GIT_ENV });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${(result.stderr || result.error?.message || '').trim()}`);
}

function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

const SKELETON = { 'src/features/tasks/tasks-screen.tsx': 'export {};\n' };
// A localized baseline: without core.quotePath=false git prints this name as a quoted C string that
// no gatedPaths glob matches, while the hook (-z) sees the real path.
const ARABIC_BASELINE = '.maestro/baselines/t\u00e2che-ar.png';

/**
 * The repo root: a skeleton commit, then a commit that added the localized baseline without a
 * Gate-Change trailer, and nothing staged (what an amend or reword sees). staged-repo/: a separate
 * repository with the baseline staged and not yet committed.
 */
function buildRepos(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  write(dir, SKELETON);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'chore(repo): add the app skeleton']);
  write(dir, { [ARABIC_BASELINE]: 'baseline\n' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'test(tasks): add the arabic task list baseline']);
  const staged = join(dir, 'staged-repo');
  mkdirSync(staged);
  git(staged, ['init', '-q']);
  write(staged, SKELETON);
  git(staged, ['add', '-A']);
  git(staged, ['commit', '-q', '-m', 'chore(repo): add the app skeleton']);
  write(staged, { [ARABIC_BASELINE]: 'baseline\n' });
  git(staged, ['add', '-A']);
}

const filesOf = (dir) => readFileSync(join(dir, 'files.txt'), 'utf8').split('\n').filter(Boolean).join(',');
const report = (kind, file = 'report.md') => (dir) => [dir, '--report', join(dir, file), '--kind', kind];

await runSelftest(import.meta.url, [
  { script: 'check-commits.mjs', fixtures: '../tests/fixtures/check-commits', args: (dir) => [dir, '--log', join(dir, 'commits.log')] },
  { script: 'check-commits.mjs', fixtures: '../tests/fixtures/check-commit-message', args: (dir) => [dir, '--message', join(dir, 'message.txt'), '--files', filesOf(dir)] },
  // --staged and --range on real repositories: non-ASCII gated paths, and HEAD's files when nothing is staged.
  { script: 'check-commits.mjs', fixtures: '../tests/fixtures/check-commits-git', base: [{ build: async (dir) => buildRepos(dir) }], args: (dir) => [join(dir, 'staged-repo'), '--message', join(dir, 'message.txt'), '--staged'] },
  // The sample list the repo's commit-msg hook test also runs (the base is the shipped template).
  { script: 'check-commits.mjs', fixtures: '../tests/fixtures/check-commits-samples', args: (dir) => ['--samples', join(dir, 'commit-message-samples.json')] },
  { script: 'check-tags.mjs', fixtures: '../tests/fixtures/check-tags', args: (dir) => [dir, '--list', join(dir, 'tags.txt')] },
  { script: 'check-report.mjs', fixtures: '../tests/fixtures/check-report', args: report('release') },
  { script: 'check-report.mjs', fixtures: '../tests/fixtures/check-report-slice', args: report('slice') },
  { script: 'check-report.mjs', fixtures: '../tests/fixtures/check-request', args: report('request', 'message.md') },
  // The optional change blocks: goldens and baselines changed on purpose, texts changed in every locale.
  { script: 'check-report.mjs', fixtures: '../tests/fixtures/check-report-changes', args: report('slice') },
]);
