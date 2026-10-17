// scripts/eas/release-plan.test.ts
import { configProblems, lastReleaseVersion, repoProblems } from './release-plan.ts';

import type { EasJson } from './eas-profile.ts';

const APP_ID = 'com.example.tasks';
const EAS: EasJson = {
  cli: { appVersionSource: 'remote', requireCommit: true },
  build: {
    production: {
      node: '26.4.0',
      autoIncrement: true,
      env: { APP_VARIANT: 'production', EXPO_PUBLIC_APP_VARIANT: 'production' },
    },
  },
  submit: {
    production: { ios: { bundleIdentifier: APP_ID }, android: { applicationId: APP_ID } },
  },
};
const CLEAN = { gitStatus: '', branch: 'main', releaseBranch: 'main' };
const IDS = { ios: APP_ID, android: APP_ID };

describe('lastReleaseVersion', () => {
  it('takes the highest vX.Y.Z and ignores upload tags', () => {
    const tags = ['v1.2.0', 'v1.10.0', 'v1.9.3', 'v2.0.0+ios.40', 'v1.10.0+android.7', 'nightly'];
    expect(lastReleaseVersion(tags)).toBe('1.10.0');
    expect(lastReleaseVersion([''])).toBeNull();
  });
});

describe('repoProblems', () => {
  it('passes a clean tree on the release branch with a store profile', () => {
    expect(repoProblems(EAS, 'production', CLEAN)).toStrictEqual([]);
  });

  it('stops a dirty tree and another branch', () => {
    const facts = { ...CLEAN, gitStatus: ' M app.config.ts\n?? notes.md', branch: 'feat/x' };
    expect(repoProblems(EAS, 'production', facts)).toStrictEqual([
      'the working tree has uncommitted or untracked files: commit or stash them',
      'HEAD is on "feat/x", not on the release branch "main"',
    ]);
  });

  it('reports a profile problem once, not once per platform', () => {
    const local: EasJson = { ...EAS, cli: { requireCommit: true } };
    expect(repoProblems(local, 'production', CLEAN)).toStrictEqual([
      'cli.appVersionSource is not "remote"',
    ]);
  });
});

describe('configProblems', () => {
  it('passes a version above the last release with the pinned ids', () => {
    const facts = { version: '1.3.0', ids: IDS, tags: ['v1.2.0', 'v1.3.0+ios.12'] };
    expect(configProblems(EAS, 'production', facts)).toStrictEqual([]);
    expect(configProblems(EAS, 'production', { ...facts, tags: [] })).toStrictEqual([]);
  });

  it('wants the version raised above the last release tag', () => {
    const facts = { version: '1.2.0', ids: IDS, tags: ['v1.2.0'] };
    expect(configProblems(EAS, 'production', facts)).toStrictEqual([
      'version 1.2.0 is not above the last release v1.2.0: raise it',
    ]);
    const odd = { ...facts, version: '1.2' };
    expect(configProblems(EAS, 'production', odd)).toStrictEqual([
      'the app config version "1.2" is not MAJOR.MINOR.PATCH',
    ]);
  });

  it('catches a config evaluated as another variant', () => {
    const facts = { version: '1.3.0', ids: { ...IDS, android: `${APP_ID}.dev` }, tags: [] };
    expect(configProblems(EAS, 'production', facts)).toStrictEqual([
      `the android id of the build is ${APP_ID}.dev, but submit.production pins ${APP_ID}`,
    ]);
  });
});
