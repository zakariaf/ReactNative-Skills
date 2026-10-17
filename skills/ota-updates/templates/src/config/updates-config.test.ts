// src/config/updates-config.test.ts
import { EAS_UPDATE_HOST, easUpdateUrl, isEasProjectId, updatesConfig } from './updates-config';

const PROJECT_ID = '9b1f3c2a-4d5e-4f60-8a7b-1c2d3e4f5a6b';

describe('isEasProjectId', () => {
  it('accepts a lowercase UUID', () => {
    expect(isEasProjectId(PROJECT_ID)).toBe(true);
  });

  it('rejects placeholders, uppercase copies and partial ids', () => {
    expect(isEasProjectId('your-project-id')).toBe(false);
    expect(isEasProjectId(PROJECT_ID.toUpperCase())).toBe(false);
    expect(isEasProjectId(PROJECT_ID.slice(0, 30))).toBe(false);
    expect(isEasProjectId('')).toBe(false);
  });
});

describe('easUpdateUrl', () => {
  it('builds the EAS Update manifest URL of the project', () => {
    expect(EAS_UPDATE_HOST).toMatch(/^https:\/\/u\.expo\.dev$/u);
    expect(easUpdateUrl(PROJECT_ID)).toBe(`${EAS_UPDATE_HOST}/${PROJECT_ID}`);
  });

  it('throws on a value that is not a project id', () => {
    expect(() => easUpdateUrl('your-project-id')).toThrow('is not an EAS project id');
  });
});

describe('updatesConfig', () => {
  it('derives the runtime version from the fingerprint and never blocks launch', () => {
    expect(updatesConfig(PROJECT_ID)).toStrictEqual({
      runtimeVersion: { policy: 'fingerprint' },
      updates: {
        enabled: true,
        url: `${EAS_UPDATE_HOST}/${PROJECT_ID}`,
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
      },
    });
  });

  it('returns a new object on every call, so one variant cannot change another', () => {
    expect(updatesConfig(PROJECT_ID)).not.toBe(updatesConfig(PROJECT_ID));
  });
});
