// src/core/dates/generator-versions.test.ts
import { assertVersionTable, latestVersion, versionFor } from './generator-versions';

import type { GeneratorVersion } from './generator-versions';

const TABLE: readonly GeneratorVersion[] = [
  { version: 1, from: null },
  { version: 2, from: '2027-03-01' },
  { version: 3, from: '2028-01-01' },
];

/** A share-code generator: the version travels with the code, so no entry has a cutover key. */
const TEXT_TABLE: readonly GeneratorVersion[] = [
  { version: 1, from: null },
  { version: 2, from: null },
];

describe('generator versions', () => {
  it('routes each key to the last cutover on or before it', () => {
    expect(versionFor(TABLE, '2026-09-26')).toBe(1);
    expect(versionFor(TABLE, '2027-02-28')).toBe(1);
    expect(versionFor(TABLE, '2027-03-01')).toBe(2);
    expect(versionFor(TABLE, '2027-12-31')).toBe(2);
    expect(versionFor(TABLE, '2028-01-01')).toBe(3);
    expect(latestVersion(TABLE)).toBe(3);
  });

  it('accepts a valid table', () => {
    expect(() => {
      assertVersionTable(TABLE);
    }).not.toThrow();
  });

  it('rejects gaps, a dated version 1, bad keys and cutovers that go back', () => {
    expect(() => {
      assertVersionTable([]);
    }).toThrow('at least version 1');
    expect(() => {
      assertVersionTable([{ version: 1, from: '2026-01-01' }]);
    }).toThrow('version 1 must have from: null');
    expect(() => {
      assertVersionTable([
        { version: 1, from: null },
        { version: 3, from: '2027-01-01' },
      ]);
    }).toThrow('entry 1 is version 3');
    expect(() => {
      assertVersionTable([
        { version: 1, from: null },
        { version: 2, from: '2027-02-30' },
      ]);
    }).toThrow('needs a date key');
    expect(() => {
      assertVersionTable([...TABLE, { version: 4, from: '2027-06-01' }]);
    }).toThrow('not after 2028-01-01');
  });

  it('throws when no version serves a key', () => {
    expect(() => versionFor([], '2026-01-01')).toThrow('no generator version serves 2026-01-01');
    expect(() => latestVersion([])).toThrow(RangeError);
  });

  it('accepts a text-keyed table only in text mode, and only with from: null everywhere', () => {
    expect(() => {
      assertVersionTable(TEXT_TABLE, { keyKind: 'text' });
    }).not.toThrow();
    expect(() => {
      assertVersionTable(TEXT_TABLE);
    }).toThrow('version 2 needs a date key');
    expect(() => {
      assertVersionTable(TABLE, { keyKind: 'text' });
    }).toThrow('version 2 of a text-keyed table must have from: null');
    expect(() => {
      assertVersionTable([{ version: 1, from: '2026-01-01' }], { keyKind: 'text' });
    }).toThrow('version 1 must have from: null');
  });

  it('makes text-keyed callers pass the version instead of routing to the newest', () => {
    expect(() => versionFor(TEXT_TABLE, '2026-09-26')).toThrow('pass the version');
    expect(latestVersion(TEXT_TABLE)).toBe(2);
  });
});
