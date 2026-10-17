#!/usr/bin/env node
// selftest.mjs: proves both scripts against tests/fixtures/. check-feature runs on the shipped templates
// (filled with assets/template-placeholders.json) over a small app base, with one planted bug per rule;
// scaffold-feature plans, conflicts and bad input on a second base; check-feature-generated runs the
// generator with --write for a static route (plain View root) and, once the app has ScreenFrame, a
// dynamic route (ScreenFrame root), and proves its output passes the checker.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest, UsageError } from './check-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCAFFOLDS = [
  ['--feature', 'notes', '--route', '(app)/notes', '--title', 'Notes'],
  ['--feature', 'note-detail', '--route', '(app)/notes/[noteId]', '--title', 'Note'],
];

/** The empty app with both features written by the generator, as a developer would run it. */
async function generatedApp(dir) {
  cpSync(join(here, '..', 'tests', 'bases', 'empty-app'), dir, { recursive: true });
  for (const [index, args] of SCAFFOLDS.entries()) {
    if (index === 1) {
      // From here on the app has react-components-and-hooks' ScreenFrame: the view's root becomes it.
      mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
      writeFileSync(join(dir, 'src', 'ui', 'screen-frame.tsx'), '// src/ui/screen-frame.tsx (react-components-and-hooks)\n');
    }
    const result = spawnSync(process.execPath, [join(here, 'scaffold-feature.mjs'), dir, ...args, '--write'], { encoding: 'utf8' });
    if (result.status !== 0) throw new UsageError(`scaffold-feature ${args.join(' ')} --write exited ${result.status}: ${result.stdout}${result.stderr}`, 'Fix the generator or tests/bases/empty-app.');
  }
}

await runSelftest(import.meta.url, [
  { script: 'check-feature.mjs', fixtures: '../tests/fixtures/check-feature', args: () => ['.'] },
  // The common request; a case's ARGS.txt replaces it (its first word is the repo root, ".").
  { script: 'scaffold-feature.mjs', fixtures: '../tests/fixtures/scaffold-feature', args: () => ['.', ...SCAFFOLDS[0]] },
  { script: 'check-feature.mjs', fixtures: '../tests/fixtures/check-feature-generated', args: () => ['.'], base: [{ build: generatedApp }] },
]);
