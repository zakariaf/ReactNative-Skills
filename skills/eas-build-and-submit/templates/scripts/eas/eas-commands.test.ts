// scripts/eas/eas-commands.test.ts
import {
  BUILDS_JSON,
  commandLine,
  easBuildArgs,
  easSubmitArgs,
  GATED_ARTIFACTS,
  hasUploadTag,
  releaseLines,
  uploadTag,
  WHAT_TO_TEST_MAX,
} from './eas-commands.ts';

const PRODUCTION = 'production';
const CHECKER = '<eas-build-and-submit>/scripts/check-eas-build.mjs';
const TAGGED = { checker: CHECKER, uploadTags: ['v1.1.0+ios.41', 'v1.1.0+android.77', 'v1.1.0'] };

describe('easBuildArgs', () => {
  it('names the profile, never prompts, freezes credentials and does not submit by default', () => {
    const args = easBuildArgs(
      {
        profile: PRODUCTION,
        platform: 'all',
        autoSubmit: false,
        message: 'feat(tasks): due dates',
      },
      true,
    );
    expect(args).toStrictEqual([
      'build',
      '--profile',
      PRODUCTION,
      '--platform',
      'all',
      '--non-interactive',
      '--freeze-credentials',
      '--message',
      'feat(tasks): due dates',
    ]);
    expect(args).not.toContain('--auto-submit');
  });

  it('refuses auto-submit for Android: its .aab is submitted only after its gate read it', () => {
    const plan = { profile: PRODUCTION, autoSubmit: true, message: 'm' } as const;
    expect(() => easBuildArgs({ ...plan, platform: 'android' }, true)).toThrow('iOS only');
    expect(() => easBuildArgs({ ...plan, platform: 'all' }, true)).toThrow('iOS only');
    expect(easBuildArgs({ ...plan, platform: 'ios' }, true)).toContain('--auto-submit');
  });

  it('refuses auto-submit from a profile that is not a store profile', () => {
    const plan = { profile: 'preview', platform: 'ios', autoSubmit: true, message: 'm' } as const;
    expect(() => easBuildArgs(plan, false)).toThrow('needs a store profile');
    expect(easBuildArgs({ ...plan, autoSubmit: false }, false)).not.toContain('--auto-submit');
  });

  it('passes What to Test with auto-submit, within the TestFlight limit, never for Android', () => {
    const plan = { profile: PRODUCTION, platform: 'ios', autoSubmit: true, message: 'm' } as const;
    expect(easBuildArgs({ ...plan, whatToTest: 'Check reminders' }, true).slice(-2)).toStrictEqual([
      '--what-to-test',
      'Check reminders',
    ]);
    const long = 'x'.repeat(WHAT_TO_TEST_MAX + 1);
    expect(() => easBuildArgs({ ...plan, whatToTest: long }, true)).toThrow('over 4000');
    expect(() => easBuildArgs({ ...plan, whatToTest: ' ' }, true)).toThrow('empty');
    const android = { ...plan, platform: 'android', whatToTest: 'x' } as const;
    expect(() => easBuildArgs(android, true)).toThrow('iOS only');
    const local = { ...plan, autoSubmit: false, whatToTest: 'x' };
    expect(() => easBuildArgs(local, true)).toThrow('together with --auto-submit');
  });
});

describe('easSubmitArgs', () => {
  it('submits the gated file with --path, never --latest', () => {
    const path = GATED_ARTIFACTS.android;
    const args = easSubmitArgs({ profile: PRODUCTION, platform: 'android', path });
    expect(args).toStrictEqual([
      'submit',
      '--profile',
      PRODUCTION,
      '--platform',
      'android',
      '--path',
      path,
      '--non-interactive',
    ]);
    expect(args).not.toContain('--latest');
  });

  it('refuses a file that is not the platform archive', () => {
    const plan = { profile: PRODUCTION, platform: 'ios', path: GATED_ARTIFACTS.android } as const;
    expect(() => easSubmitArgs(plan)).toThrow('not a gated .ipa file');
  });
});

describe('releaseLines', () => {
  const plan = {
    profile: PRODUCTION,
    platform: 'all',
    autoSubmit: false,
    message: 'feat(tasks): due dates',
    whatToTest: 'Check reminders',
  } as const;

  it('builds without submitting, checks each record, gates each download, then submits it', () => {
    const lines = releaseLines(plan, true, { ...TAGGED, version: '1.2.0' });
    expect(lines.build).toBe(
      "eas build --profile production --platform all --non-interactive --freeze-credentials --message 'feat(tasks): due dates' --json > dist/eas/builds.json",
    );
    expect(lines.build).not.toContain('--auto-submit');
    expect(lines.build).not.toContain('--what-to-test');
    expect(lines.checks).toStrictEqual([
      `node ${CHECKER} . --build ${BUILDS_JSON} --platform ios`,
      `node ${CHECKER} . --build ${BUILDS_JSON} --platform android`,
    ]);
    expect(lines.gates).toStrictEqual([
      `curl -fsSL -o ${GATED_ARTIFACTS.ios} <ios-archive-url>`,
      `node <ios-release-testflight>/scripts/check-store-artifact.mjs . --ipa ${GATED_ARTIFACTS.ios} --variant production --version 1.2.0 --build <ios-build-number>`,
      `curl -fsSL -o ${GATED_ARTIFACTS.android} <android-archive-url>`,
      `node <android-release-play>/scripts/check-store-aab.mjs . --aab ${GATED_ARTIFACTS.android} --version-code <android-build-number> --stamp build/release-android/aab-gate.json`,
    ]);
    expect(lines.submits).toStrictEqual([
      `eas submit --profile production --platform ios --path ${GATED_ARTIFACTS.ios} --non-interactive --what-to-test 'Check reminders'`,
      `eas submit --profile production --platform android --path ${GATED_ARTIFACTS.android} --non-interactive`,
    ]);
    expect(lines.untagged).toStrictEqual([]);
  });

  it('asks for the last build number of a platform that has no upload tag yet', () => {
    const lines = releaseLines(plan, true, { checker: CHECKER, uploadTags: ['v1.1.0+ios.41'] });
    expect(lines.checks).toStrictEqual([
      `node ${CHECKER} . --build ${BUILDS_JSON} --platform ios`,
      `node ${CHECKER} . --build ${BUILDS_JSON} --platform android --previous <last-android-build-number>`,
    ]);
    expect(lines.untagged).toStrictEqual(['android']);
    const first = releaseLines(plan, true, { checker: CHECKER, uploadTags: [''] });
    expect(first.untagged).toStrictEqual(['ios', 'android']);
    expect(first.checks[0]).toContain('--platform ios --previous <last-ios-build-number>');
  });

  it('submits from an iOS build only when asked, What to Test on the build, no submit lines', () => {
    const ios = { ...plan, platform: 'ios', autoSubmit: true } as const;
    const lines = releaseLines(ios, true, TAGGED);
    expect(lines.build).toContain("--auto-submit --what-to-test 'Check reminders' --json");
    expect(lines.gates).toStrictEqual([]);
    expect(lines.submits).toStrictEqual([]);
    expect(() => releaseLines(ios, false, TAGGED)).toThrow('needs a store profile');
    expect(() => releaseLines({ ...plan, autoSubmit: true }, true, TAGGED)).toThrow('iOS only');
  });

  it('refuses What to Test for an Android-only release before printing anything', () => {
    expect(() => releaseLines({ ...plan, platform: 'android' }, true, TAGGED)).toThrow('iOS only');
    const android = {
      profile: PRODUCTION,
      platform: 'android',
      autoSubmit: false,
      message: 'm',
    } as const;
    expect(releaseLines(android, true, TAGGED).submits).toHaveLength(1);
  });
});

describe('hasUploadTag', () => {
  it('counts only vX.Y.Z+<platform>.<n> tags of that platform', () => {
    expect(hasUploadTag(['v1.4.0+ios.14'], 'ios')).toBe(true);
    expect(hasUploadTag(['v1.4.0+ios.14', 'v1.4.0'], 'android')).toBe(false);
    expect(hasUploadTag(['v1.4.0+14', 'mobile/v1.4.0+ios.14'], 'ios')).toBe(false);
  });
});

describe('uploadTag', () => {
  it('writes the per-platform upload tag and its annotation', () => {
    expect(uploadTag('1.4.0', 'ios', 14)).toStrictEqual({
      name: 'v1.4.0+ios.14',
      message: 'App Store build 14',
    });
    expect(uploadTag('1.4.0', 'android', 31)).toStrictEqual({
      name: 'v1.4.0+android.31',
      message: 'Play build 31',
    });
  });

  it('refuses a version that is not x.y.z and a build number below 1', () => {
    expect(() => uploadTag('1.4', 'ios', 1)).toThrow('MAJOR.MINOR.PATCH');
    expect(() => uploadTag('1.4.0', 'ios', 0)).toThrow('positive integer');
  });
});

describe('commandLine', () => {
  it('quotes only what the shell would split', () => {
    expect(commandLine(['build', '--message', "it's done", '--profile', PRODUCTION])).toBe(
      "eas build --message 'it'\\''s done' --profile production",
    );
  });
});
