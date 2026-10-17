// scripts/audit/network-pods-layer.test.ts
import { externalSources, foreignSource, podProblems, trunkPods } from './network-pods-layer.ts';

const REMOTE_GIT = ['https', '://git.example.test/remote-kit.git'].join('');
const REMOTE_PODSPEC = ['https', '://git.example.test/x.podspec'].join('');
const LOCK = [
  'PODS:',
  '  - Google-Mobile-Ads-SDK (13.6.0)',
  '',
  'DEPENDENCIES:',
  '  - ExpoModulesCore (from `../node_modules/expo-modules-core`)',
  '',
  'SPEC REPOS:',
  '  trunk:',
  '    - Google-Mobile-Ads-SDK',
  '    - GoogleUserMessagingPlatform',
  '    - SomeAnalytics',
  '',
  'EXTERNAL SOURCES:',
  '  ExpoModulesCore:',
  '    :path: "../node_modules/expo-modules-core"',
  '  RemoteKit:',
  `    :git: ${REMOTE_GIT}`,
  '    :tag: 1.0.0',
  '  OutsideKit:',
  '    :path: "../../outside-kit"',
  '',
].join('\n');
const DECLARED = new Set(['Google-Mobile-Ads-SDK', 'GoogleUserMessagingPlatform']);

describe('the pods layer', () => {
  it('reads the trunk pods and the external sources', () => {
    expect(trunkPods(LOCK)).toStrictEqual([
      'Google-Mobile-Ads-SDK',
      'GoogleUserMessagingPlatform',
      'SomeAnalytics',
    ]);
    expect(externalSources(LOCK).get('RemoteKit')).toStrictEqual({
      git: REMOTE_GIT,
      tag: '1.0.0',
    });
  });

  it('accepts a folder in the repo and refuses remote or outside sources', () => {
    expect(foreignSource({ path: '../node_modules/expo-modules-core' })).toBeNull();
    expect(foreignSource({ path: '../../../node_modules/react-native' })).toBeNull();
    expect(foreignSource({ path: '../../outside-kit' })).toStrictEqual([
      'path',
      '../../outside-kit',
    ]);
    expect(foreignSource({ podspec: REMOTE_PODSPEC })).toStrictEqual(['podspec', REMOTE_PODSPEC]);
  });

  it('fails every trunk pod no declared SDK brings and every foreign source', () => {
    expect(podProblems(LOCK, DECLARED)).toStrictEqual([
      'trunk pod SomeAnalytics is not brought by an SDK declared in contracts/privacy.json',
      `pod RemoteKit comes from a :git source (${REMOTE_GIT}), not the trunk or the repo`,
      'pod OutsideKit comes from a :path source (../../outside-kit), not the trunk or the repo',
    ]);
  });
});
