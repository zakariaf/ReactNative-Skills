// scripts/config/scene-support.test.ts
import { addSceneSupport } from './scene-support.ts';

import type { ExpoConfig } from 'expo/config';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

const SCENE = { enableSceneSupport: true };

describe('addSceneSupport', () => {
  it('appends an expo-build-properties entry when the list has none', () => {
    expect(addSceneSupport(['expo-sqlite'])).toStrictEqual([
      'expo-sqlite',
      ['expo-build-properties', { ios: SCENE }],
    ]);
  });

  it('merges into the existing entry and keeps its iOS and Android options', () => {
    const plugins: PluginEntry[] = [
      [
        'expo-build-properties',
        { ios: { useFrameworks: 'static' }, android: { minSdkVersion: 26 } },
      ],
    ];
    expect(addSceneSupport(plugins)).toStrictEqual([
      [
        'expo-build-properties',
        { ios: { useFrameworks: 'static', ...SCENE }, android: { minSdkVersion: 26 } },
      ],
    ]);
  });

  it('turns a bare expo-build-properties string into an entry with options', () => {
    expect(addSceneSupport(['expo-build-properties'])).toStrictEqual([
      ['expo-build-properties', { ios: SCENE }],
    ]);
  });

  it('keeps every other plugin as it was', () => {
    const plugins: PluginEntry[] = [
      'expo-sqlite',
      ['expo-font', { fonts: [] }],
      'expo-build-properties',
    ];
    const result = addSceneSupport(plugins);
    expect(result.slice(0, 2)).toStrictEqual(plugins.slice(0, 2));
    expect(result).toHaveLength(3);
  });
});
