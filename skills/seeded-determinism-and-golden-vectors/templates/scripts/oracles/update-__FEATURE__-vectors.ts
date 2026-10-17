// scripts/oracles/update-__FEATURE__-vectors.ts
// Fills the missing fingerprints and summaries of the __FEATURE__ vectors file from the independent
// oracle. Run it by hand from the repo root after adding rows ({ "key", "version", "note" }), then
// read the diff before committing:
//   node scripts/oracles/update-__FEATURE__-vectors.ts
// It never changes a filled row (a shipped output never changes: add a version instead), and no CI
// job, git hook or test script runs it: CI only verifies. The one exception is the template rows
// after you set your own salt and catalog: delete each row's fingerprint and summary by hand, keep
// key, version and note, and rerun. Deleting the values of any other committed row does not get
// round the refusal: check-golden-vectors.mjs compares every row with the committed vectors file.
import { readFileSync, writeFileSync } from 'node:fs';

import { fillVectorRows, oracleRow } from './__FEATURE__-oracle.ts';

import type { VectorRow } from './__FEATURE__-oracle.ts';

const VECTORS_FILE = 'src/features/__FEATURE__/__FEATURE__.vectors.json';

type VectorsFile = { readonly rows: readonly VectorRow[] } & Readonly<Record<string, unknown>>;

const vectors = JSON.parse(readFileSync(VECTORS_FILE, 'utf8')) as VectorsFile;
const result = fillVectorRows(vectors.rows, oracleRow);

if (result.problems.length > 0) {
  for (const problem of result.problems) console.error(`changed row refused: ${problem}`);
  console.error(
    'A shipped row never changes: restore the generator version that made it, or add a version. ' +
      'Only if no released build has served this generator yet (for example the template rows ' +
      'after you set your own salt and catalog), delete the fingerprint and summary of those rows ' +
      'and rerun.',
  );
  process.exitCode = 1;
} else {
  writeFileSync(VECTORS_FILE, `${JSON.stringify({ ...vectors, rows: result.rows }, null, 2)}\n`);
  console.log(
    `${VECTORS_FILE}: ${String(result.rows.length)} rows; read the diff before committing`,
  );
}
