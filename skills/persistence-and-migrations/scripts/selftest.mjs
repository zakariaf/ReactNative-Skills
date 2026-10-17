#!/usr/bin/env node
// selftest.mjs: proves the checkers against planted bugs (overlay fixtures, assembled by check-lib).
// - check-persistence: tests/bases/app (package.json, tsconfig paths, a root layout) + this skill's
//   templates at the paths their first lines name, so the good case proves the shipped templates pass
//   every rule, the migration replay on node:sqlite included; each bad-* case plants one bug.
// - check-persistence-document: the same plus tests/bases/both (mode "both": a v0002 step that creates
//   the document slots and its frozen db-v2.sql), so the save-document appendix rules run too.
// - inspect-database: the frozen db-v2.sql dump as app.sql; each bad-* case damages it one way.
//   bad-page-damage writes a 4-page binary database (page_size 512, user_version 1, WAL) whose page 2
//   b-tree header was overwritten with 0xff bytes: page 1 reads, integrity_check throws SQLITE_CORRUPT.
// kill-test.mjs needs a named device; its verdict is inspect-database's, covered here. Run
// `node kill-test.mjs --dry-run ...` to see its plan without a device.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { join } from 'node:path';

import { resultLine, runSelftest } from './check-lib.mjs';
import { textChecksum } from './lib/database-health.mjs';

// The checkers' checksum must give exactly what the app's src/data/checksum.ts gives (its
// checksum.test.ts pins the same vectors), or a recorded fixture checksum means two things.
const VECTORS = [
  ['', '811c9dc5'],
  ['a', 'e40c292c'],
  ['شراء الحليب 📊', '7db38061'],
  ['line one\r\nline two', textChecksum('line one\nline two')],
];
const wrong = VECTORS.filter(([text, expected]) => textChecksum(text) !== expected);
for (const [text, expected] of wrong) {
  console.log(`FAIL scripts/lib/database-health.mjs [checksum-vector] textChecksum(${JSON.stringify(text)}) is ${textChecksum(text)}, expected ${expected} Fix: Keep FNV-1a 32 over UTF-16 code units, CRLF read as LF.`);
}
if (wrong.length > 0) {
  console.log(resultLine(wrong.length));
  process.exit(1);
}
console.log(`ok   checksum vectors (${VECTORS.length} pinned values)`);

const INSPECT_ARGS = ['--expect-version', '2', '--max-version', '2', '--document', '--app-id', 'tasks-app', '--max-document-version', '1'];

await runSelftest(import.meta.url, [
  { script: 'check-persistence.mjs', fixtures: '../tests/fixtures/check-persistence', args: (dir) => [dir] },
  { script: 'check-persistence.mjs', fixtures: '../tests/fixtures/check-persistence-document', args: (dir) => [dir] },
  { script: 'inspect-database.mjs', fixtures: '../tests/fixtures/inspect-database', args: (dir) => [join(dir, 'app.sql'), ...INSPECT_ARGS] },
]);
