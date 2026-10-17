// scripts/hooks/after-edit.ts
// device-only: covered by the Claude Code PostToolUse hook, which runs it after every Edit or Write
// Claude Code PostToolUse hook (Edit|Write): formats and lints the one file just edited. Exit 2 with
// the problems on stderr is the only result the agent sees; any other exit is a non-blocking error:
// the agent never sees it, and the user sees only a one-line notice. The repo root is found from
// this file's own place (scripts/hooks/), so the hook works from any working directory inside the
// repo, and the tools run through `npx --no --` (the installed copy, never a download).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PRETTIER_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml)$/u;
const ESLINT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/u;
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

type HookInput = { readonly tool_input?: { readonly file_path?: string } };
type ToolRun = { readonly ok: boolean; readonly output: string };

function npx(args: readonly string[]): ToolRun {
  const result = spawnSync('npx', ['--no', '--', ...args], { encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

/** The edited file relative to the repo root, or null for a file outside the repo. */
function editedFile(): string | null {
  const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  const filePath = input.tool_input?.file_path;
  if (filePath === undefined) {
    return null;
  }
  const relative = path.relative(REPO_ROOT, path.resolve(filePath));
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : relative;
}

function main(): number {
  process.chdir(REPO_ROOT);
  const file = editedFile();
  if (file === null || !PRETTIER_EXTENSIONS.test(file)) {
    return 0;
  }
  const format = npx(['prettier', '--write', '--ignore-unknown', '--log-level', 'warn', file]);
  const lint = ESLINT_EXTENSIONS.test(file)
    ? npx(['eslint', '--fix', '--max-warnings', '0', '--no-warn-ignored', file])
    : { ok: true, output: '' };
  if (format.ok && lint.ok) {
    return 0;
  }
  console.error(`after-edit: fix these problems in ${file}\n${format.output}${lint.output}`);
  return 2;
}

process.exitCode = main();
