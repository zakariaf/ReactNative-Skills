// scripts/git/check-commit-message.ts
import { spawnSync } from 'node:child_process';

export function stagedDiff(): string {
  return spawnSync('git', ['diff', '--cached'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;
}
