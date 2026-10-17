// scripts/config/scene-support.ts
// iOS scene life cycle for Expo SDK 57 apps built with Xcode 27 (the iOS 27 SDK): turns on
// expo-build-properties ios.enableSceneSupport, which needs expo 57.0.23 or newer. app.config.ts
// imports it with the extension, import { addSceneSupport } from './scripts/config/scene-support.ts';
// (Expo loads app.config.ts through Node, which needs the .ts), and wraps its plugin list:
// plugins: addSceneSupport([...]). A no-op from SDK 58 on, which handles the scene life cycle
// itself: delete this file, its test and the call in the SDK 58 move commit.
import type { ExpoConfig } from 'expo/config';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];
type Options = Readonly<Record<string, unknown>>;

const BUILD_PROPERTIES = 'expo-build-properties';

function isRecord(value: unknown): value is Options {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withScene(options: unknown): Options {
  const base = isRecord(options) ? options : {};
  const ios = isRecord(base['ios']) ? base['ios'] : {};
  return { ...base, ios: { ...ios, enableSceneSupport: true } };
}

function isBuildProperties(entry: PluginEntry): boolean {
  return entry === BUILD_PROPERTIES || (Array.isArray(entry) && entry[0] === BUILD_PROPERTIES);
}

/**
 * Turns on ios.enableSceneSupport: merges it into the existing expo-build-properties entry (a second
 * entry would run the plugin twice), or appends one when the list has none. Android is untouched.
 */
export function addSceneSupport(plugins: readonly PluginEntry[]): PluginEntry[] {
  if (!plugins.some(isBuildProperties)) {
    return [...plugins, [BUILD_PROPERTIES, withScene(undefined)]];
  }
  return plugins.map((entry) => {
    if (!isBuildProperties(entry)) {
      return entry;
    }
    const options: unknown = Array.isArray(entry) ? Reflect.get(entry, 1) : undefined;
    return [BUILD_PROPERTIES, withScene(options)];
  });
}
