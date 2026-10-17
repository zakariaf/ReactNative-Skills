// scripts/git/check-commit-message.ts
// The lefthook commit-msg job: `node scripts/git/check-commit-message.ts {1}` (quality-gates owns
// lefthook.yml). It applies commit-message-rules.ts to the message git is about to store, with the
// commit's files for the Gate-Change rule, and refuses the commit on any problem. The
// git-commits-and-reporting skill's check-commits.mjs applies the same rules with the same ids.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readCommitRules } from './commit-config.ts';
import { checkCommitMessage } from './commit-message-rules.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// A commit that stages a vendored skills folder lists thousands of paths; Node's default 1 MB
// buffer made the hook crash with "spawnSync git ENOBUFS".
const GIT_OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;

function gitPaths(args: readonly string[]): readonly string[] {
  const output = execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
  });
  return output.split('\0').filter((file) => file.length > 0);
}

/** False before the first commit, when there is no HEAD to compare with. */
const hasHead = (): boolean =>
  spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: REPO_ROOT }).status === 0;

/**
 * The files of the commit being made. Nothing staged means an amend or a reword (git refuses an
 * empty commit without --allow-empty), and the index then equals HEAD, so the staged diff would hide
 * the commit's own files: judge HEAD's files instead. An amend that also stages new files sees only
 * those; reword with `git reset --soft HEAD~1` and a fresh commit, which shows the hook every file.
 */
function commitFiles(): readonly string[] {
  const staged = gitPaths(['diff', '--cached', '--name-only', '-z']);
  if (staged.length > 0 || !hasHead()) {
    return staged;
  }
  return gitPaths(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']);
}

function main(messageFile: string | undefined): number {
  if (messageFile === undefined) {
    console.error('usage: node scripts/git/check-commit-message.ts <commit-msg-file>');
    return 2;
  }
  const problems = checkCommitMessage({
    message: readFileSync(messageFile, 'utf8'),
    files: commitFiles(),
    rules: readCommitRules(REPO_ROOT),
  });
  for (const found of problems) {
    console.error(
      `commit-msg: line ${String(found.line)} [${found.rule}] ${found.message} Fix: ${found.fix}`,
    );
  }
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv[2]);
