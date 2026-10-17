// scripts/release-android/version-code.test.ts
import fc from 'fast-check';

import {
  androidBuildNumbers,
  bumpVersionCode,
  nextVersionCode,
  readVersionCode,
  tagPrefixOf,
  uploadTag,
  usedVersionCodeProblems,
  VERSION_CODE_MAX,
} from './version-code.ts';

const CONFIG =
  'const ANDROID_VERSION_CODE = 14;\nexport default { android: { versionCode: ANDROID_VERSION_CODE } };\n';
const TAGS = ['v1.3.0+12', 'v1.4.0+14', 'v1.4.0+ios.20', 'v1.4.0', 'backup', 'mobile/v1.4.0+40'];

describe('androidBuildNumbers', () => {
  it('reads shared and Android tags and ignores iOS-only and release tags', () => {
    expect(androidBuildNumbers([...TAGS, 'v1.5.0+android.31'], null)).toStrictEqual([12, 14, 31]);
  });

  it('reads only the tags of one app when multi-package', () => {
    expect(androidBuildNumbers(TAGS, 'mobile')).toStrictEqual([40]);
  });
});

describe('readVersionCode', () => {
  it('reads the one literal versionCode', () => {
    expect(readVersionCode(CONFIG)).toBe(14);
  });

  it('refuses a config with none or two', () => {
    expect(() => readVersionCode('export default {};')).toThrow('exactly one');
    expect(() => readVersionCode(`${CONFIG}${CONFIG}`)).toThrow('exactly one');
  });
});

describe('nextVersionCode', () => {
  it('goes one above the config and every Android upload tag', () => {
    expect(nextVersionCode({ current: 14, tags: TAGS, prefix: null })).toBe(15);
    expect(nextVersionCode({ current: 3, tags: ['v1.0.0+android.30'], prefix: null })).toBe(31);
  });

  it('is always above every input number', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.array(fc.nat({ max: 1_000_000 })),
        (current, numbers) => {
          const tags = numbers.map((value) => `v1.0.0+android.${String(value)}`);
          const next = nextVersionCode({ current, tags, prefix: null });
          return next > current && numbers.every((value) => next > value);
        },
      ),
    );
  });

  it("refuses to pass Google Play's maximum", () => {
    expect(() => nextVersionCode({ current: VERSION_CODE_MAX, tags: [], prefix: null })).toThrow(
      "above Google Play's maximum",
    );
  });
});

describe('bumpVersionCode', () => {
  it('rewrites only the literal', () => {
    expect(bumpVersionCode(CONFIG, 15)).toBe(CONFIG.replace('= 14;', '= 15;'));
  });

  it('refuses to lower or repeat a number', () => {
    expect(() => bumpVersionCode(CONFIG, 14)).toThrow('can only go up');
  });
});

describe('usedVersionCodeProblems', () => {
  it('refuses a number a tag holds, or one below it', () => {
    expect(usedVersionCodeProblems(14, { tags: TAGS, prefix: null })).toStrictEqual([
      'versionCode 14 is not above the upload tag v1.4.0+14: a number is never reused or rolled back',
    ]);
    expect(usedVersionCodeProblems(15, { tags: TAGS, prefix: null })).toStrictEqual([]);
  });
});

describe('uploadTag', () => {
  it('names the version and the Android number, with the app folder when multi-package', () => {
    expect(uploadTag({ version: '1.4.0', versionCode: 15, prefix: null })).toBe(
      'v1.4.0+android.15',
    );
    expect(uploadTag({ version: '1.4.0', versionCode: 15, prefix: 'mobile' })).toBe(
      'mobile/v1.4.0+android.15',
    );
  });

  it('writes a tag the next build counts', () => {
    const tag = uploadTag({ version: '1.4.0', versionCode: 15, prefix: null });

    expect(nextVersionCode({ current: 14, tags: [tag], prefix: null })).toBe(16);
  });
});

describe('tagPrefixOf', () => {
  it('is null at the repo root and the app folder inside a workspace', () => {
    expect(tagPrefixOf('')).toBeNull();
    expect(tagPrefixOf('apps/mobile/')).toBe('mobile');
  });
});
