// scripts/release/release-failures.test.ts
import { classifyReleaseFailure, resumeHint, stopMessage } from './release-failures.ts';

describe('classifyReleaseFailure', () => {
  it.each([
    ['errSecInternalComponent', 'keychain-locked', 'unlock the keychain'],
    ['You have not agreed to the Xcode license agreements.', 'xcode-license', 'Xcode licence'],
    ['You must accept the updated Program License Agreement', 'agreement', 'accept the agreement'],
    ['xcodebuild: error: PLA Update available', 'agreement', 'accept the agreement'],
    ['No App Store Connect app record for com.acme.tasks.', 'app-record-missing', 'app record'],
    ['App Store Connect answered 401 (NOT_AUTHORIZED)', 'not-authorized', 'API key'],
    ['FORBIDDEN_ERROR: not allowed to create distribution certificates', 'forbidden', 'API key'],
    ['"processingState": "INVALID"', 'processing-invalid', "Apple's email"],
    [
      '- [ship-placeholder] Info.plist GADApplicationIdentifier is ...',
      'ship-placeholder',
      'real values',
    ],
  ])('stops and asks the developer on "%s"', (output, id, humanStep) => {
    expect(classifyReleaseFailure(output)).toMatchObject({ id, isStop: true, humanStep });
  });

  it('quotes the line that matched, not the last line of the log', () => {
    const log = 'CodeSign Tasks.app\nerrSecInternalComponent\n** ARCHIVE FAILED **\n';
    expect(classifyReleaseFailure(log)?.line).toBe('errSecInternalComponent');
  });

  it('does not read a bare 401 or 403 in a build log as an Apple answer', () => {
    expect(classifyReleaseFailure('ld: warning: 401 duplicate symbols, 403 files')).toBeNull();
  });

  it.each([
    ['ERROR ITMS-90189: "Redundant Binary Upload."', 'build-number-reused'],
    ['ERROR ITMS-90062: version must be higher', 'version-not-raised'],
    ['ITMS-90683: Missing purpose string in Info.plist', 'purpose-string'],
    ['ITMS-91053: Missing API declaration', 'privacy-manifest'],
    ["error: No profiles for 'com.acme.tasks' were found", 'signing-flags'],
  ])('names the agent fix for "%s"', (output, id) => {
    expect(classifyReleaseFailure(output)).toMatchObject({ id, isStop: false, humanStep: null });
  });

  it('returns null for an unknown failure', () => {
    expect(classifyReleaseFailure('Segmentation fault')).toBeNull();
  });
});

describe('resumeHint', () => {
  it.each([
    ['preflight-verify', 'rerun the same release:ios command'],
    ['archive', '--resume build'],
    ['upload', '--resume processing'],
  ])('tells the agent how to rerun after a failure in "%s"', (step, hint) => {
    expect(resumeHint(step)).toContain(hint);
  });
});

describe('stopMessage', () => {
  it('names the step, the human step, the error line and the one action', () => {
    const verdict = classifyReleaseFailure('errSecInternalComponent');
    expect(verdict).not.toBeNull();
    const message = stopMessage(
      'archive',
      'errSecInternalComponent\n',
      verdict ?? { id: '', isStop: true, humanStep: null, action: '' },
    );
    expect(message).toContain(
      'Release stopped at step "archive" (human step: unlock the keychain).',
    );
    expect(message).toContain('Error: errSecInternalComponent');
  });
});
