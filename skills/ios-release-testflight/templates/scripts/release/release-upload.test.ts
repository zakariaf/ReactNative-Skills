// scripts/release/release-upload.test.ts
// Steps 11-12 on stand-ins: no git tag is made, no key is read and App Store Connect is never asked.
import { execFileSync } from 'node:child_process';

import { describeAndTag } from './release-upload.ts';
import { setWhatsNew } from '../asc/beta-notes.ts';

jest.mock('node:child_process', () => ({ execFileSync: jest.fn(() => '') }));
jest.mock('../asc/beta-notes.ts', () => ({ setWhatsNew: jest.fn() }));
jest.mock('../asc/asc-credentials.ts', () => ({ loadAscCredentials: jest.fn() }));
jest.mock('../asc/asc-jwt.ts', () => ({
  createAscJwt: () => 'jwt',
  ASC_TOKEN_LIFETIME_SECONDS: 900,
}));

const CHECKED = 'Tasks 1.4.0 (8) · preview build\nWhat changed\n- checked in preflight';
const ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
const INPUT = {
  pre: {
    ids: { keyId: 'KEY', issuerId: 'ISSUER', teamId: 'TEAM' },
    keyFile: '/keys/AuthKey_KEY.p8',
    app: { name: 'Tasks', bundleId: 'com.acme.tasks.preview', version: '1.4.0', appleAppId: '1' },
    whatToTest: CHECKED,
    humanSteps: [],
  },
  prefix: '',
  variant: 'preview',
  buildNumber: 8,
  restId: 'build-1',
} as const;

describe('describeAndTag (release steps 11 and 12)', () => {
  afterEach(() => {
    jest.mocked(execFileSync).mockReset();
    jest.mocked(setWhatsNew).mockReset();
  });

  it('sets What to Test to the text the preflight checked, then makes the annotated tag', async () => {
    await expect(describeAndTag(INPUT, ENV)).resolves.toBe(CHECKED);
    expect(jest.mocked(setWhatsNew)).toHaveBeenCalledWith('jwt', 'build-1', CHECKED);
    expect(jest.mocked(execFileSync)).toHaveBeenCalledWith('git', [
      'tag',
      '-a',
      'v1.4.0+ios.8',
      '-m',
      'App Store build 8 (TestFlight, preview)',
    ]);
  });

  it('keeps the resume line when the tag fails after What to Test was set', async () => {
    jest.mocked(execFileSync).mockImplementation(() => {
      throw new Error("fatal: tag 'v1.4.0+ios.8' already exists");
    });
    await expect(describeAndTag(INPUT, ENV)).rejects.toThrow(
      "fatal: tag 'v1.4.0+ios.8' already exists\nResume: the build is VALID; rerun with --resume processing to set What to Test and tag it.",
    );
  });
});
