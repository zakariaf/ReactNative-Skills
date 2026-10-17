// src/features/__FEATURE__/__FEATURE__-vectors.test.ts
// The golden vectors: every row was computed by the independent oracle
// (scripts/oracles/__FEATURE__-oracle.ts) and is filled only by
// `node scripts/oracles/update-__FEATURE__-vectors.ts`, run by hand and reviewed. CI only verifies.
import { FINGERPRINT_ALGORITHM, fingerprint } from '@/core/rng/fingerprint';

import { generate__FEATURE_PASCAL__, summarize__FEATURE_PASCAL__ } from './__FEATURE__-generator';
import vectors from './__FEATURE__.vectors.json';

describe('__FEATURE__ golden vectors', () => {
  it('names the fingerprint algorithm the rows were made with', () => {
    expect(vectors.fingerprint).toBe(FINGERPRINT_ALGORITHM);
    expect(vectors.rows.length).toBeGreaterThanOrEqual(3);
  });

  it.each(vectors.rows)('reproduces $key at version $version ($note)', (row) => {
    const output = generate__FEATURE_PASCAL__(row.key, row.version);
    expect(output.version).toBe(row.version);
    expect(summarize__FEATURE_PASCAL__(output)).toBe(row.summary);
    expect(fingerprint(output)).toBe(row.fingerprint);
  });
});
