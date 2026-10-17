// scripts/e2e/build-guard.test.ts
import { e2eBuildProblem, idsOfEmbeddedConfig } from './build-guard.ts';

const PRODUCTION = ['com.example.tasks'];
const CONFIG = JSON.stringify({
  scheme: ['tasks-preview', 'exp+tasks'],
  ios: { bundleIdentifier: 'com.example.tasks.preview' },
  android: { package: 'com.example.tasks.preview' },
  extra: { adsMode: 'off', router: {} },
});

describe('idsOfEmbeddedConfig', () => {
  it('reads the app id of the platform and the first scheme', () => {
    expect(idsOfEmbeddedConfig(CONFIG, 'ios')).toStrictEqual({
      id: 'com.example.tasks.preview',
      scheme: 'tasks-preview',
      extra: { adsMode: 'off', router: {} },
    });
    expect(
      idsOfEmbeddedConfig(
        JSON.stringify({ scheme: 'tasks', android: { package: 'a.b' } }),
        'android',
      ),
    ).toStrictEqual({ id: 'a.b', scheme: 'tasks', extra: {} });
  });

  it('names what is missing', () => {
    expect(idsOfEmbeddedConfig(JSON.stringify({ scheme: 'tasks' }), 'ios')).toBe(
      'the embedded app config has no ios app id',
    );
    expect(idsOfEmbeddedConfig(JSON.stringify({ android: { package: 'a.b' } }), 'android')).toBe(
      'the embedded app config has no scheme',
    );
  });
});

describe('e2eBuildProblem', () => {
  const preview = {
    platform: 'ios',
    id: 'com.example.tasks.preview',
    hasEmbeddedBundle: true,
    extra: { adsMode: 'off' },
  } as const;

  it('accepts a Release build of a test variant', () => {
    expect(e2eBuildProblem(preview, PRODUCTION)).toBeNull();
    expect(e2eBuildProblem(preview, PRODUCTION, { adsMode: 'off' })).toBeNull();
  });

  it('refuses a Debug build, which loads its code from Metro', () => {
    const app = { ...preview, platform: 'android', hasEmbeddedBundle: false } as const;
    expect(e2eBuildProblem(app, PRODUCTION)).toContain('Debug build');
  });

  it('refuses the production variant, which has no debug link', () => {
    const app = { ...preview, id: 'com.example.tasks' } as const;
    expect(e2eBuildProblem(app, PRODUCTION)).toContain('production variant');
  });

  it('refuses an ads-on build when buildExtra wants adsMode off', () => {
    const adsOn = { ...preview, extra: { adsMode: 'test' } } as const;
    expect(e2eBuildProblem(adsOn, PRODUCTION, { adsMode: 'off' })).toContain(
      'has "test" for extra.adsMode',
    );
    const noKey = { ...preview, extra: {} } as const;
    expect(e2eBuildProblem(noKey, PRODUCTION, { adsMode: 'off' })).toContain(
      'has no extra.adsMode',
    );
  });
});
