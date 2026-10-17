// test/config-plugins/run-mod.test.ts
import { withGradleProperties, withInfoPlist } from 'expo/config-plugins.js';

import { runMod } from './run-mod';

import type { ExpoConfig } from 'expo/config';
import type { ConfigPlugin, ExportedConfig } from 'expo/config-plugins.js';

/** A fresh config per test: Expo's with* helpers assign config.mods on the object they are given. */
function baseConfig(): ExpoConfig {
  return { name: 'Tasks', slug: 'tasks' };
}

/** Appends `value` to the TasksOrder key, so a test sees which mod ran first. */
function withPlistValue(value: string): ConfigPlugin {
  return (config) =>
    withInfoPlist(config, (next) => {
      const before = next.modResults['TasksOrder'];
      const prefix = typeof before === 'string' ? before : '';
      return { ...next, modResults: { ...next.modResults, TasksOrder: `${prefix}${value}` } };
    });
}

describe('runMod', () => {
  it('runs a queued mod on the contents it is given', async () => {
    const config = withPlistValue('a')(baseConfig(), undefined);

    const plist = await runMod(config, { platform: 'ios', mod: 'infoPlist', modResults: {} });

    expect(plist).toStrictEqual({ TasksOrder: 'a' });
  });

  it('runs the newest mod first, so the first plugin applied writes last', async () => {
    const config = withPlistValue('second')(
      withPlistValue('first')(baseConfig(), undefined),
      undefined,
    );

    const plist = await runMod(config, { platform: 'ios', mod: 'infoPlist', modResults: {} });

    expect(plist).toStrictEqual({ TasksOrder: 'secondfirst' });
  });

  it('runs Android mods with the same request shape', async () => {
    const config = withGradleProperties(baseConfig(), (next) => ({
      ...next,
      modResults: [...next.modResults, { type: 'property', key: 'tasks.flag', value: 'true' }],
    }));

    const properties = await runMod(config, {
      platform: 'android',
      mod: 'gradleProperties',
      modResults: [],
    });

    expect(properties).toStrictEqual([{ type: 'property', key: 'tasks.flag', value: 'true' }]);
  });

  it('documents that with* helpers write the mod onto the config object they receive', () => {
    const config: ExportedConfig = baseConfig();

    withPlistValue('a')(config, undefined);

    expect(config.mods?.ios?.infoPlist).toBeInstanceOf(Function);
  });

  it('throws when no mod was queued for the file', async () => {
    await expect(
      runMod(baseConfig(), { platform: 'android', mod: 'manifest', modResults: {} }),
    ).rejects.toThrow('no android.manifest mod is queued');
  });
});
