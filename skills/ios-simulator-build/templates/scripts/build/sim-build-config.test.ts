// scripts/build/sim-build-config.test.ts
import { DEFAULT_LINK_FLOW, parseSimBuildConfig } from './sim-build-config.ts';

describe('parseSimBuildConfig', () => {
  it('fills every default when the contract is absent', () => {
    expect(parseSimBuildConfig(undefined, '@acme/tasks')).toStrictEqual({
      simulatorPrefix: 'tasks',
      deviceType: 'iPhone 17 Pro Max',
      postPrebuild: [],
      readyMarker: null,
      linkFlow: DEFAULT_LINK_FLOW,
      maestroBin: 'maestro',
    });
  });

  it('takes the values the contract sets and ignores the keys only the checkers read', () => {
    const config = parseSimBuildConfig(
      {
        simulatorPrefix: 'tasks-ci',
        postPrebuild: ['audit:privacy'],
        readyMarker: { file: 'Documents/test-hooks/ready.txt', contains: 'home' },
        appId: 'com.acme.tasks',
        usageStrings: ['NSCameraUsageDescription'],
      },
      'tasks',
    );
    expect(config).toMatchObject({
      simulatorPrefix: 'tasks-ci',
      postPrebuild: ['audit:privacy'],
      readyMarker: { file: 'Documents/test-hooks/ready.txt', contains: 'home' },
    });
  });

  it('rejects a prefix that is not kebab-case and names the key', () => {
    expect(() => parseSimBuildConfig({ simulatorPrefix: 'Tasks App' }, 'tasks')).toThrow(
      'simulatorPrefix: must be kebab-case',
    );
  });

  it('rejects an empty npm script name', () => {
    expect(() => parseSimBuildConfig({ postPrebuild: [''] }, 'tasks')).toThrow('postPrebuild.0');
  });
});
