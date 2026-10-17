// scripts/release/release-options.test.ts
import {
  archiveArgs,
  ascKeyFile,
  exportArgs,
  parseReleaseArgs,
  readAscIds,
  uploadArgs,
  xcodeAuthArgs,
} from './release-options.ts';

const IDS = { keyId: '2X9R4HXF34', issuerId: 'issuer-uuid', teamId: 'TEAM123456' };

describe('parseReleaseArgs', () => {
  it('reads a production release with notes and known issues', () => {
    const options = parseReleaseArgs([
      ...['--variant', 'production'],
      ...['--notes', 'new list sorting', '--notes', 'reminder sound', '--known-issue', 'none yet'],
    ]);
    expect(options).toStrictEqual({
      variant: 'production',
      adsMode: null,
      notes: ['new list sorting', 'reminder sound'],
      knownIssues: ['none yet'],
      resume: null,
    });
  });

  it('reads where a stopped run resumes, and refuses an unknown point', () => {
    const base = ['--variant', 'preview'];
    expect(parseReleaseArgs([...base, '--resume', 'processing']).resume).toBe('processing');
    expect(() => parseReleaseArgs([...base, '--resume', 'archive'])).toThrow(
      '--resume archive is not one of build|processing',
    );
  });

  it('requires the variant and refuses one that never reaches TestFlight', () => {
    expect(() => parseReleaseArgs([])).toThrow(
      '--variant (missing) is not one of preview|production',
    );
    expect(() => parseReleaseArgs(['--variant', 'development'])).toThrow('is not one of');
  });

  it('refuses test ads in a production release and live ads in a preview release', () => {
    expect(() => parseReleaseArgs(['--variant', 'production', '--ads', 'test'])).toThrow(
      '--ads test is not one of live|off',
    );
    expect(() => parseReleaseArgs(['--variant', 'preview', '--ads', 'live'])).toThrow(
      '--ads live is not one of test|off',
    );
  });
});

describe('readAscIds', () => {
  it('names every missing id and the human step', () => {
    expect(() => readAscIds({ APPLE_TEAM_ID: 'TEAM123456' })).toThrow(
      'ASC_KEY_ID, ASC_ISSUER_ID not set. Human step (API key)',
    );
  });

  it('returns the three ids', () => {
    const env = { ASC_KEY_ID: 'K', ASC_ISSUER_ID: 'I', APPLE_TEAM_ID: 'T' };
    expect(readAscIds(env)).toStrictEqual({ keyId: 'K', issuerId: 'I', teamId: 'T' });
  });
});

describe('command arguments', () => {
  it('derives the key path from the key id without reading the key', () => {
    expect(ascKeyFile('/var/empty/dev', 'ABC')).toBe(
      '/var/empty/dev/.appstoreconnect/private_keys/AuthKey_ABC.p8',
    );
  });

  it('archives for any iOS device with automatic API-key signing', () => {
    const auth = xcodeAuthArgs('/keys/AuthKey_2X9R4HXF34.p8', IDS);
    const args = archiveArgs({ workspace: 'ios/Tasks.xcworkspace', scheme: 'Tasks' }, auth);
    expect(args).toStrictEqual(
      expect.arrayContaining(['generic/platform=iOS', '-allowProvisioningUpdates', 'archive']),
    );
    expect(args).not.toContain('CODE_SIGNING_ALLOWED=NO');
  });

  it('exports preview builds with the internal-only options file', () => {
    const args = exportArgs(
      { scheme: 'Tasks', variant: 'preview', optionsDir: 'scripts/release' },
      [],
    );
    expect(args).toContain('scripts/release/export-options-preview.plist');
  });

  it('uploads with --wait and the four identifying flags', () => {
    const meta = {
      appleAppId: '6400000000',
      bundleId: 'com.acme.tasks',
      buildNumber: 8,
      version: '1.4.0',
    };
    const args = uploadArgs('build/ios-release/export/Tasks.ipa', meta, IDS);
    expect(args).toStrictEqual(
      expect.arrayContaining([
        '--upload-package',
        '--apple-id',
        '6400000000',
        '--bundle-version',
        '8',
        '--bundle-id',
        'com.acme.tasks',
        '--wait',
      ]),
    );
  });
});
