// scripts/oracles/__FEATURE__-oracle.test.ts
// CI verifies, never blesses: this test proves the committed vectors are what the independent
// oracle computes; src/features/__FEATURE__/__FEATURE__-vectors.test.ts proves the generator agrees.
import vectors from '@/features/__FEATURE__/__FEATURE__.vectors.json';

import { fillVectorRows, fnv1a32, oracleRow, rawDraws, seedWords } from './__FEATURE__-oracle.ts';

describe('__FEATURE__ oracle', () => {
  it('matches the published FNV-1a and sfc32 reference values it was written from', () => {
    expect(fnv1a32('')).toBe(0x811c_9dc5n);
    expect(fnv1a32('a')).toBe(0xe40c_292cn);
    expect(rawDraws([1n, 2n, 3n, 4n], 3)).toStrictEqual([7n, 34n, 56_623_200n]);
    expect(rawDraws(seedWords(1n), 2)).toStrictEqual([1_828_152_527n, 3_394_835_397n]);
  });

  it.each(vectors.rows)('agrees with the committed row for $key at version $version', (row) => {
    expect(oracleRow(row.key, row.version)).toStrictEqual({
      fingerprint: row.fingerprint,
      summary: row.summary,
    });
  });

  it('fills a new row and refuses to change a filled one', () => {
    const added = { key: '2029-01-01', version: 1, note: 'new row' };
    const changed = { ...added, key: '2026-09-26', fingerprint: '00000000', summary: 'x' };
    const result = fillVectorRows([added, changed], oracleRow);
    expect(result.rows[0]).toStrictEqual({ ...added, ...oracleRow('2029-01-01', 1) });
    expect(result.rows[1]).toBe(changed);
    expect(result.problems).toHaveLength(1);
  });

  it('throws for a version it was not written for', () => {
    expect(() => oracleRow('2026-09-26', 9)).toThrow('no version 9');
  });
});
