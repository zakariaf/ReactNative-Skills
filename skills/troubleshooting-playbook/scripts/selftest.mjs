#!/usr/bin/env node
// selftest.mjs: proves every checker of this skill passes its good fixture and catches every planted
// bug in the bad-* fixtures (one per rule), that this skill's own catalogue passes check-catalogue
// (every recorded error line in assets/known-queries.tsv finds its entry first), and that find-fix
// answers text, log, id, platform and version queries.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

/** The repo root find-fix reads: the case folder, or the path that root.txt names inside it (a missing root). */
function repoRoot(dir) {
  const file = join(dir, 'root.txt');
  return existsSync(file) ? join(dir, readFileSync(file, 'utf8').trim()) : dir;
}

/** One --text per line of the case's query.txt (ARGS.txt splits on spaces, so multi-word queries live there). */
function textQueries(dir) {
  const file = join(dir, 'query.txt');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => ['--text', line]) : [];
}

await runSelftest(import.meta.url, [
  { script: 'check-known-pitfalls.mjs', fixtures: '../tests/fixtures/check-known-pitfalls', args: (dir) => [dir] },
  { script: 'check-catalogue.mjs', fixtures: '../tests/fixtures/check-catalogue', args: (dir) => ['--catalogue', join(dir, 'catalogue'), '--references', join(dir, 'references'), '--queries', join(dir, 'queries.tsv')] },
  { script: 'find-fix.mjs', fixtures: '../tests/fixtures/find-fix', args: (dir) => [repoRoot(dir), ...textQueries(dir)] },
]);
