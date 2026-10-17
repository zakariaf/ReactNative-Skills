// scripts/release-android/release-args.test.ts
import { isHelpRequest, parseReleaseArgs } from './release-args.ts';

describe('parseReleaseArgs', () => {
  it('reads the four commands', () => {
    expect(parseReleaseArgs(['build', '--notes', 'Reminders'])).toStrictEqual({
      command: 'build',
      notes: 'Reminders',
    });
    expect(parseReleaseArgs(['upload', '--draft-app'])).toStrictEqual({
      command: 'upload',
      notes: null,
      isDraftApp: true,
      isReviewSentByHand: false,
    });
    expect(
      parseReleaseArgs(['rollout', '--version-code', '15', '--fraction', '0.2']),
    ).toStrictEqual({
      command: 'rollout',
      versionCode: 15,
      fraction: 0.2,
      isReviewSentByHand: false,
    });
    expect(parseReleaseArgs(['halt', '--fraction', '0.05', '--version-code', '15'])).toStrictEqual({
      command: 'halt',
      versionCode: 15,
      fraction: 0.05,
      isReviewSentByHand: false,
    });
  });

  it('commits without sending for review only when the flag is given', () => {
    expect(parseReleaseArgs(['upload', '--changes-not-sent-for-review'])).toMatchObject({
      isReviewSentByHand: true,
    });
    expect(
      parseReleaseArgs([
        'rollout',
        '--version-code',
        '15',
        '--fraction',
        '0.2',
        '--changes-not-sent-for-review',
      ]),
    ).toMatchObject({ isReviewSentByHand: true });
    expect(() => parseReleaseArgs(['build', '--changes-not-sent-for-review'])).toThrow(
      'unexpected argument',
    );
  });

  it('refuses unknown commands and flags of another command', () => {
    expect(() => parseReleaseArgs([])).toThrow('unknown command ""');
    expect(() => parseReleaseArgs(['submit'])).toThrow('unknown command "submit"');
    expect(() => parseReleaseArgs(['build', '--track', 'production'])).toThrow(
      'unexpected argument "--track"',
    );
    expect(() => parseReleaseArgs(['build', '--notes'])).toThrow('--notes needs a value');
  });

  it('refuses a bad versionCode or fraction', () => {
    expect(() => parseReleaseArgs(['rollout', '--version-code', '0', '--fraction', '0.2'])).toThrow(
      '--version-code must be a positive integer',
    );
    expect(() => parseReleaseArgs(['rollout', '--version-code', '15', '--fraction', '2'])).toThrow(
      '--fraction must be a number in (0, 1]',
    );
    expect(() => parseReleaseArgs(['halt', '--version-code', '15'])).toThrow('--fraction must be');
  });
});

describe('isHelpRequest', () => {
  it('sees --help and -h anywhere', () => {
    expect(isHelpRequest(['upload', '-h'])).toBe(true);
    expect(isHelpRequest(['--help'])).toBe(true);
    expect(isHelpRequest(['build'])).toBe(false);
  });
});
