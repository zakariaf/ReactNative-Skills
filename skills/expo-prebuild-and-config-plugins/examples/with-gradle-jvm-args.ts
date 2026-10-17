// examples/with-gradle-jvm-args.ts: a second typed-mod shape (gradle.properties), for a Tasks app
// whose CI release build runs out of Gradle heap. Not a template: copy the shape, not the numbers.
// The SDK 57 template writes org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m; no config key
// or expo-build-properties option sets it, so a plugin owns it. withGradleProperties is a typed,
// introspectable mod: replace the entry by key (idempotent), keep every other line.
import { withGradleProperties } from 'expo/config-plugins.js';

import type { AndroidConfig, ConfigPlugin } from 'expo/config-plugins.js';

type PropertiesItem = AndroidConfig.Properties.PropertiesItem;

export type GradleJvmArgsOptions = { readonly maxHeap: string; readonly maxMetaspace: string };

const SIZE = /^\d+[mg]$/;
const KEY = 'org.gradle.jvmargs';

export function setJvmArgs(
  items: PropertiesItem[],
  { maxHeap, maxMetaspace }: GradleJvmArgsOptions,
): PropertiesItem[] {
  if (!SIZE.test(maxHeap) || !SIZE.test(maxMetaspace)) {
    throw new Error('withGradleJvmArgs: sizes look like "4g" or "1024m".');
  }
  const value = `-Xmx${maxHeap} -XX:MaxMetaspaceSize=${maxMetaspace}`;
  const kept = items.filter((item) => !(item.type === 'property' && item.key === KEY));
  return [...kept, { type: 'property', key: KEY, value }];
}

const withGradleJvmArgs: ConfigPlugin<GradleJvmArgsOptions | undefined> = (config, options) => {
  if (options === undefined) {
    throw new Error(
      "withGradleJvmArgs: ['./plugins/with-gradle-jvm-args.ts', { maxHeap: '4g', maxMetaspace: '1g' }]",
    );
  }
  return withGradleProperties(config, (next) => ({
    ...next,
    modResults: setJvmArgs(next.modResults, options),
  }));
};

/** @public Expo loads it from the path app.config.ts names, so it is the default export. */
export default withGradleJvmArgs;
