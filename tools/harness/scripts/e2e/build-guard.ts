// scripts/e2e/build-guard.ts
// Which build a run may test, read from the build itself: a Release build (its JavaScript is
// embedded, so no Metro WebSocket and no dev menu) of a test variant (development or preview: the
// test-only code, the debug link and the debug menu are in it). A store build has no debug link and
// a Debug build talks to Metro, which hides the app's own network traffic; the runner refuses both
// before it touches a device. contracts/e2e.json buildExtra adds values the embedded expo.extra
// must hold: { "adsMode": "off" } for an app with ads (admob-ads-and-consent's ADS_MODE=off build),
// because an ads-on build shows Google's consent form and Apple's tracking prompt over a cleared
// launch and its ad SDK opens sockets the network proof would have to allow. The app id, URL scheme
// and extra come from the build's embedded app config (iOS EXConstants.bundle/app.config, Android
// assets/app.config), never from the repo.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { E2eConfig } from './e2e-config.ts';
import type { BuiltApp, Platform } from './e2e-device.ts';

/** The public app config Expo embeds in every native build (expo-constants). */
type EmbeddedConfig = {
  readonly scheme?: string | readonly string[];
  readonly ios?: { readonly bundleIdentifier?: string };
  readonly android?: { readonly package?: string };
  readonly extra?: Readonly<Record<string, unknown>>;
};

type EmbeddedIds = {
  readonly id: string;
  readonly scheme: string;
  readonly extra: Readonly<Record<string, unknown>>;
};

const firstScheme = (config: EmbeddedConfig): string | undefined =>
  typeof config.scheme === 'string' ? config.scheme : config.scheme?.[0];

/** The app id, first URL scheme and extra of the embedded config for one platform, or the problem. */
export function idsOfEmbeddedConfig(json: string, platform: Platform): EmbeddedIds | string {
  const config = JSON.parse(json) as EmbeddedConfig;
  const id = platform === 'ios' ? config.ios?.bundleIdentifier : config.android?.package;
  const scheme = firstScheme(config);
  if (typeof id !== 'string' || id === '')
    return `the embedded app config has no ${platform} app id`;
  if (typeof scheme !== 'string' || scheme === '') return 'the embedded app config has no scheme';
  return { id, scheme, extra: config.extra ?? {} };
}

/** The first buildExtra value the build's extra does not hold, as a problem, or null. */
function extraProblem(
  app: Pick<BuiltApp, 'id' | 'extra'>,
  buildExtra: Readonly<Record<string, string>>,
): string | null {
  for (const [key, wanted] of Object.entries(buildExtra)) {
    const actual = app.extra[key];
    if (actual === wanted) continue;
    const found = actual === undefined ? 'has no' : `has ${JSON.stringify(actual)} for`;
    const ads =
      key === 'adsMode'
        ? ' Build it with ADS_MODE=off (admob-ads-and-consent): with ads on, the consent form and the tracking prompt cover every cleared launch and the ad SDK opens sockets; ads flows run by hand in the ads smoke folder.'
        : '';
    return `${app.id} ${found} extra.${key}, but contracts/e2e.json buildExtra wants ${JSON.stringify(wanted)}.${ads} An app without this key in its config removes it from buildExtra.`;
  }
  return null;
}

/**
 * Null when the build may be tested; else why not and what to build instead. `productionAppIds`
 * are the store ids (contracts/e2e.json): a build with one of them is the production variant.
 * `buildExtra` are values the embedded expo.extra must hold (adsMode off for an app with ads).
 */
export function e2eBuildProblem(
  app: Pick<BuiltApp, 'id' | 'hasEmbeddedBundle' | 'platform' | 'extra'>,
  productionAppIds: readonly string[],
  buildExtra: Readonly<Record<string, string>> = {},
): string | null {
  if (!app.hasEmbeddedBundle) {
    return `${app.id} is a Debug build (no embedded JavaScript bundle): it loads its code from Metro, whose WebSocket hides the app's own traffic. Build a Release build of the preview variant.`;
  }
  if (productionAppIds.includes(app.id)) {
    return `${app.id} is the production variant: it has no test-only code, so no debug link and no debug menu. Build the preview (or development) variant in Release.`;
  }
  return extraProblem(app, buildExtra);
}

/** Throws with the reason when the build may not be tested. */
export function requireE2eBuild(
  app: BuiltApp,
  config: Pick<E2eConfig, 'productionAppIds' | 'buildExtra'>,
): void {
  const problem = e2eBuildProblem(app, config.productionAppIds, config.buildExtra);
  if (problem !== null) throw new Error(`e2e: ${problem}`);
}

function plistValue(plist: string, key: string): string {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], {
    encoding: 'utf8',
  }).trim();
}

/** A simulator .app: the embedded config, main.jsbundle and the executable from Info.plist. */
export function readIosBuild(appPath: string): BuiltApp {
  const configPath = join(appPath, 'EXConstants.bundle', 'app.config');
  if (!existsSync(configPath))
    throw new Error(`e2e: ${configPath} is missing: is this an Expo build?`);
  const ids = idsOfEmbeddedConfig(readFileSync(configPath, 'utf8'), 'ios');
  if (typeof ids === 'string') throw new Error(`e2e: ${appPath}: ${ids}`);
  return {
    platform: 'ios',
    path: appPath,
    ...ids,
    executable: plistValue(join(appPath, 'Info.plist'), 'CFBundleExecutable'),
    hasEmbeddedBundle: existsSync(join(appPath, 'main.jsbundle')),
  };
}

/** An .apk: the embedded config (assets/app.config) and the embedded bundle, read with unzip. */
export function readAndroidBuild(apkPath: string): BuiltApp {
  if (!existsSync(apkPath)) throw new Error(`e2e: ${apkPath} does not exist`);
  const config = execFileSync('unzip', ['-p', apkPath, 'assets/app.config'], { encoding: 'utf8' });
  const ids = idsOfEmbeddedConfig(config, 'android');
  if (typeof ids === 'string') throw new Error(`e2e: ${apkPath}: ${ids}`);
  const listing = execFileSync('unzip', ['-l', apkPath], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return {
    platform: 'android',
    path: apkPath,
    ...ids,
    executable: ids.id,
    hasEmbeddedBundle: listing.includes('assets/index.android.bundle'),
  };
}
