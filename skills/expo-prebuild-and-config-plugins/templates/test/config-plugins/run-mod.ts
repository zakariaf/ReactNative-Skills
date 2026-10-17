// test/config-plugins/run-mod.ts
// Runs the mods config plugins queued for one native file, the way npx expo prebuild runs them, on
// contents the test hands in (an Info.plist object, an AndroidManifest object, gradle.properties
// entries) instead of files on disk: no prebuild, no native folders, Expo's own mod chain. The chain
// runs newest first, so the plugin listed first in app.config.ts writes last and wins a shared key.
import type { ExpoConfig } from 'expo/config';
import type { ExportedConfig, Mod, ModPlatform } from 'expo/config-plugins.js';

/** Which file's mods to run and the contents prebuild would have read from it. */
export type RunModInput<TContents> = {
  readonly platform: ModPlatform;
  /** The mod name: infoPlist, entitlements, podfileProperties, manifest, gradleProperties, strings, ... */
  readonly mod: string;
  readonly modResults: TContents;
  readonly projectRoot?: string;
};

function queuedMod(config: ExportedConfig, platform: ModPlatform, mod: string): Mod {
  const platformMods: Readonly<Record<string, Mod | undefined>> = { ...config.mods?.[platform] };
  const queued = platformMods[mod];
  if (queued === undefined) {
    throw new Error(
      `no ${platform}.${mod} mod is queued: the plugin never called the with* helper for it`,
    );
  }
  return queued;
}

/** The file contents after every plugin's mod for that file ran on them. */
export async function runMod<TContents>(
  config: ExportedConfig,
  { platform, mod, modResults, projectRoot = '/project' }: RunModInput<TContents>,
): Promise<TContents> {
  const run = queuedMod(config, platform, mod);
  const rawConfig: ExpoConfig = Object.fromEntries(
    Object.entries(config).filter(([key]) => key !== 'mods'),
  ) as ExpoConfig;
  const result = await run({
    ...rawConfig,
    modResults,
    modRawConfig: rawConfig,
    modRequest: {
      projectRoot,
      platformProjectRoot: `${projectRoot}/${platform}`,
      modName: mod,
      platform,
      introspect: true,
    },
  });
  return result.modResults as TContents;
}
