// scripts/release/build-number.test.ts
import {
  bumpBuildNumber,
  bumpSubject,
  buildTag,
  releaseTag,
  resumableBuildNumber,
} from './build-number.ts';

const SOURCE = [
  "const APP_VERSION = '1.4.0';",
  'const IOS_BUILD_NUMBER = 7;',
  'export default () => ({ version: APP_VERSION, ios: { buildNumber: String(IOS_BUILD_NUMBER) } });',
  '',
].join('\n');

describe('bumpBuildNumber', () => {
  it('raises the single IOS_BUILD_NUMBER line by one', () => {
    const bump = bumpBuildNumber(SOURCE);
    expect(bump).toMatchObject({ previous: 7, next: 8 });
    expect(bump.text).toContain('const IOS_BUILD_NUMBER = 8;\n');
  });

  it('refuses a config with no such line, or with two', () => {
    expect(() => bumpBuildNumber('export default {};\n')).toThrow('found 0');
    expect(() => bumpBuildNumber(`${SOURCE}const IOS_BUILD_NUMBER = 3;\n`)).toThrow('found 2');
  });
});

describe('resumableBuildNumber', () => {
  const check = {
    prefix: '',
    appConfigSource: SOURCE,
    headSubject: 'chore(release): build 7\n',
    tags: ['v1.4.0+ios.6'],
  };

  it('reuses the committed number while HEAD is its bump commit and it is untagged', () => {
    expect(resumableBuildNumber(check)).toBe(7);
  });

  it('refuses when other commits came after the bump', () => {
    expect(() => resumableBuildNumber({ ...check, headSubject: 'fix(tasks): x' })).toThrow(
      'Run release:ios without --resume',
    );
  });

  it('refuses a number that already has an upload tag', () => {
    expect(() => resumableBuildNumber({ ...check, tags: [...check.tags, 'v1.4.0+ios.7'] })).toThrow(
      'already tagged',
    );
  });
});

describe('subjects and tags', () => {
  it('formats the bump commit, the upload tag and the release tag', () => {
    expect(bumpSubject('', 8)).toBe('chore(release): build 8');
    expect(buildTag('', '1.4.0', 8)).toBe('v1.4.0+ios.8');
    expect(releaseTag('', '1.4.0')).toBe('v1.4.0');
  });

  it('prefixes the app folder when multi-package', () => {
    expect(bumpSubject('mobile/', 8)).toBe('chore(mobile): build 8');
    expect(buildTag('mobile/', '1.4.0', 8)).toBe('mobile/v1.4.0+ios.8');
  });
});
