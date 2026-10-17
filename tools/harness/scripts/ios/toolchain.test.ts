// scripts/ios/toolchain.test.ts
import {
  assertXcodeVersion,
  developerDirOf,
  pickXcode,
  toolEnv,
  XCODE_VERSION,
  xcodeBuildNumber,
} from './toolchain.ts';

const INSTALLED = [
  { appPath: '/Applications/Xcode.app', version: '27.0' },
  { appPath: '/Applications/Xcode-26.6.0.app', version: '26.6' },
];

describe('pickXcode', () => {
  it('picks the app whose version matches, not the one named Xcode.app', () => {
    expect(pickXcode(INSTALLED, '26.6').appPath).toBe('/Applications/Xcode-26.6.0.app');
  });

  it('refuses a version that is not installed and names what was found', () => {
    expect(() => pickXcode(INSTALLED, '26.7')).toThrow('found: /Applications/Xcode.app (27.0)');
  });

  it('refuses when no Xcode is installed at all and names the human step', () => {
    expect(() => pickXcode([], XCODE_VERSION)).toThrow(/found: none\)\. Human step/);
  });
});

describe('assertXcodeVersion', () => {
  it('accepts the pinned first line', () => {
    expect(() => {
      assertXcodeVersion('Xcode 26.6\nBuild version 17F113\n', '26.6');
    }).not.toThrow();
  });

  it('rejects another Xcode', () => {
    expect(() => {
      assertXcodeVersion('Xcode 27.0\nBuild version 27A266a\n', '26.6');
    }).toThrow('expected "Xcode 26.6"');
  });
});

describe('xcodeBuildNumber', () => {
  it('turns a version into the DTXcode value a build carries', () => {
    expect([
      xcodeBuildNumber('26.6'),
      xcodeBuildNumber('27.0'),
      xcodeBuildNumber('26.6.1'),
    ]).toStrictEqual(['2660', '2700', '2661']);
  });
});

describe('toolEnv', () => {
  it('sets DEVELOPER_DIR, no telemetry and no prompts on top of the base env', () => {
    const developerDir = developerDirOf('/Applications/Xcode-26.6.0.app');
    expect(toolEnv({ NODE_ENV: 'test', PATH: '/usr/bin' }, developerDir)).toStrictEqual({
      NODE_ENV: 'test',
      PATH: '/usr/bin',
      DEVELOPER_DIR: '/Applications/Xcode-26.6.0.app/Contents/Developer',
      EXPO_NO_TELEMETRY: '1',
      CI: '1',
    });
  });
});
