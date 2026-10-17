// scripts/release-android/release-plan.test.ts
import {
  gateCommand,
  onlyScriptsRewritten,
  parseReleaseContract,
  preflightProblems,
  rolloutStepProblems,
  toolchainProblems,
  uploadProblems,
  uploadRelease,
} from './release-plan.ts';

import type { GateStamp } from './release-plan.ts';

const CONTRACT = {
  lane: 'local',
  applicationId: 'com.acme.tasks',
  uploadCertificateSha256: null,
  uploadTrack: 'internal',
  rollout: [0.05, 0.2, 0.5, 1],
};
const READY = {
  branch: 'main',
  releaseBranch: 'main',
  isTreeClean: true,
  isVerifyGreen: true,
  lane: 'local',
};
const STAMP: GateStamp = {
  result: 'PASS',
  sha256: 'abc',
  versionCode: 15,
  applicationId: 'com.acme.tasks',
  isRehearsal: false,
};

describe('parseReleaseContract', () => {
  it('reads the parts the tooling needs, with the default branch and notes language', () => {
    expect(parseReleaseContract(JSON.stringify(CONTRACT))).toStrictEqual({
      lane: 'local',
      applicationId: 'com.acme.tasks',
      uploadTrack: 'internal',
      rollout: [0.05, 0.2, 0.5, 1],
      releaseBranch: 'main',
      releaseNotesLanguage: 'en-US',
    });
  });

  it('takes the app own release branch and store language', () => {
    const own = { ...CONTRACT, releaseBranch: 'release/2.x', releaseNotesLanguage: 'de-DE' };

    expect(parseReleaseContract(JSON.stringify(own))).toMatchObject({
      releaseBranch: 'release/2.x',
      releaseNotesLanguage: 'de-DE',
    });
  });

  it('refuses a release branch or notes language that is not one', () => {
    expect(() =>
      parseReleaseContract(JSON.stringify({ ...CONTRACT, releaseBranch: '--force' })),
    ).toThrow('releaseBranch must look like "main"');
    expect(() =>
      parseReleaseContract(JSON.stringify({ ...CONTRACT, releaseNotesLanguage: 'English' })),
    ).toThrow('releaseNotesLanguage must look like "en-US"');
  });

  it('names the key that is wrong', () => {
    expect(() => parseReleaseContract('[]')).toThrow('is not a JSON object');
    expect(() => parseReleaseContract(JSON.stringify({ ...CONTRACT, lane: 'ci' }))).toThrow('lane');
    expect(() =>
      parseReleaseContract(JSON.stringify({ ...CONTRACT, uploadTrack: 'production' })),
    ).toThrow('uploadTrack must be internal, alpha or beta');
    expect(() => parseReleaseContract(JSON.stringify({ ...CONTRACT, applicationId: 3 }))).toThrow(
      'applicationId',
    );
    expect(() => parseReleaseContract(JSON.stringify({ ...CONTRACT, rollout: 'all' }))).toThrow(
      'rollout',
    );
  });
});

describe('preflightProblems', () => {
  it('lets a clean, verified main of a local-lane app start', () => {
    expect(preflightProblems(READY)).toStrictEqual([]);
  });

  it('lists every refusal', () => {
    const problems = preflightProblems({
      branch: 'feature/x',
      releaseBranch: 'main',
      isTreeClean: false,
      isVerifyGreen: false,
      lane: 'eas',
    });

    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('EAS builds and submits this app');
  });

  it('releases from the contract releaseBranch, not a hard-coded main', () => {
    expect(
      preflightProblems({ ...READY, branch: 'master', releaseBranch: 'master' }),
    ).toStrictEqual([]);
    expect(preflightProblems({ ...READY, branch: 'main', releaseBranch: 'master' })).toStrictEqual([
      'releases come from master (the contract releaseBranch), this is main',
    ]);
  });
});

describe('toolchainProblems', () => {
  it('needs JAVA_HOME and ANDROID_HOME', () => {
    expect(toolchainProblems({ JAVA_HOME: '/jdk', ANDROID_HOME: '/sdk' })).toStrictEqual([]);
    expect(toolchainProblems({})).toHaveLength(2);
  });
});

describe('uploadProblems', () => {
  const input = { stamp: STAMP, aabSha256: 'abc', applicationId: 'com.acme.tasks' };

  it('lets the gated bytes go', () => {
    expect(uploadProblems(input)).toStrictEqual([]);
  });

  it('refuses a missing stamp, a rehearsal, changed bytes and another app', () => {
    expect(uploadProblems({ ...input, stamp: null })[0]).toContain('no gate stamp');
    expect(uploadProblems({ ...input, stamp: { ...STAMP, isRehearsal: true } })[0]).toContain(
      'rehearsal',
    );
    expect(uploadProblems({ ...input, aabSha256: 'def' })[0]).toContain('sha256 differs');
    expect(uploadProblems({ ...input, applicationId: 'com.acme.notes' })[0]).toContain(
      'the gate checked',
    );
  });
});

describe('uploadRelease', () => {
  it('completes the release, as a draft while the Play app is one, notes in the store language', () => {
    expect(uploadRelease({ notes: null, isDraftApp: false, language: 'en-US' })).toStrictEqual({
      status: 'completed',
    });
    expect(
      uploadRelease({ notes: 'Reminders', isDraftApp: true, language: 'de-DE' }),
    ).toStrictEqual({ status: 'draft', releaseNotes: [{ language: 'de-DE', text: 'Reminders' }] });
  });
});

describe('rolloutStepProblems', () => {
  it('accepts only the contract steps', () => {
    expect(rolloutStepProblems(0.2, CONTRACT.rollout)).toStrictEqual([]);
    expect(rolloutStepProblems(0.3, CONTRACT.rollout)[0]).toContain(
      'is not one of the contract rollout steps',
    );
  });
});

describe('gateCommand', () => {
  it('names the bundle, the versionCode and the stamp', () => {
    expect(gateCommand(15)).toContain(
      '--version-code 15 --stamp build/release-android/aab-gate.json',
    );
  });
});

describe('onlyScriptsRewritten', () => {
  const before = JSON.stringify(
    { name: 'tasks', scripts: { android: 'expo start --android', ios: 'expo start --ios' } },
    null,
    2,
  );

  it('is true when the prebuild changed only the ios and android scripts', () => {
    const after = JSON.stringify(
      { name: 'tasks', scripts: { android: 'expo run:android', ios: 'expo run:ios' } },
      null,
      2,
    );

    expect(onlyScriptsRewritten(before, after)).toBe(true);
  });

  it('is false when nothing changed or something else changed too', () => {
    const other = JSON.stringify(
      { name: 'tasks', version: '2.0.0', scripts: { android: 'expo run:android' } },
      null,
      2,
    );

    expect(onlyScriptsRewritten(before, before)).toBe(false);
    expect(onlyScriptsRewritten(before, other)).toBe(false);
  });
});
