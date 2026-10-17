// scripts/ads/skadnetwork-list.test.ts — the list is read in order without duplicates, a page that
// does not look like Google's list is refused, and the module renders the full identifiers.
import {
  assertGoogleList,
  diffSkadnetworkIds,
  extractSkadnetworkIds,
  skadnetworkModuleSource,
  SKADNETWORK_FIRST,
} from './skadnetwork-list.ts';

const MANY = Array.from(
  { length: 45 },
  (_, index) => `${String(index).padStart(10, 'a')}.skadnetwork`,
);

describe('extractSkadnetworkIds', () => {
  it('reads unique identifiers in page order', () => {
    const page = `<li>${SKADNETWORK_FIRST}</li><li>4fzdc2evr5.skadnetwork</li><li>${SKADNETWORK_FIRST}</li>`;
    expect(extractSkadnetworkIds(page)).toStrictEqual([
      SKADNETWORK_FIRST,
      '4fzdc2evr5.skadnetwork',
    ]);
  });
});

describe('assertGoogleList', () => {
  it('refuses a short list or one that does not start with Google', () => {
    expect(() => {
      assertGoogleList([SKADNETWORK_FIRST]);
    }).toThrow(/refusing to overwrite/);
    expect(() => {
      assertGoogleList(MANY);
    }).toThrow(/refusing to overwrite/);
  });

  it("accepts Google's list", () => {
    expect(() => {
      assertGoogleList([SKADNETWORK_FIRST, ...MANY]);
    }).not.toThrow();
  });
});

describe('skadnetworkModuleSource', () => {
  it('names its path on line 1 and keeps the .skadnetwork suffix', () => {
    const source = skadnetworkModuleSource([SKADNETWORK_FIRST]);
    expect(source.split('\n')[0]).toBe('// src/config/skadnetwork-ids.ts');
    expect(source).toContain(`'${SKADNETWORK_FIRST}',`);
  });
});

describe('diffSkadnetworkIds', () => {
  it('lists added and removed identifiers', () => {
    expect(diffSkadnetworkIds(['a', 'b'], ['b', 'c'])).toStrictEqual({
      added: ['c'],
      removed: ['a'],
    });
  });
});
