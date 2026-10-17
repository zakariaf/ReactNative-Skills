// scripts/release/commit-notes.ts
// Commits the release notes through the hooks: no flag here skips them.
import { execFileSync } from 'node:child_process';

export function commitNotes(message: string): void {
  execFileSync('git', ['add', 'CHANGELOG.md']);
  execFileSync('git', ['commit', '-m', message]);
  execFileSync('git', ['commit', '--amend', '--no-edit']);
  execFileSync('git', ['log', '-n', '1']);
}
