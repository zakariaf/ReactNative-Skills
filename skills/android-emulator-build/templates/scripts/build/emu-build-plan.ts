// scripts/build/emu-build-plan.ts
// The pure parts of `npm run build:android:emu`: the prebuild and Gradle arguments, where the APK,
// the merged manifest, the logs and the screenshots go, the preflight of every npm script the build
// runs, and the adb VIEW intent of --link.
import { join } from 'node:path';

import { adbArgs } from '../android/adb-args.ts';

import type { EmuBuildOptions } from './emu-build-args.ts';
import type { AndroidAbi } from '../android/toolchain.ts';

/** Every build starts from a clean prebuild: android/ is generated, git-ignored and never edited. */
export const PREBUILD_ARGS = ['expo', 'prebuild', '--platform', 'android', '--clean'] as const;
/** The APK of each variant is kept here, because the next clean prebuild deletes android/. */
export const APK_DIR = join('build', 'android-emu');
/** One log per step: build/android-emu/logs/<step>.log. */
export const LOG_DIR = join(APK_DIR, 'logs');
/** Screenshots for the reviewer (git-ignored reports/). */
export const REPORT_DIR = join('reports', 'android-emu');
/** The emulator's own output (boot messages), for when it does not come up. */
export const EMULATOR_LOG = join(LOG_DIR, 'emulator.log');

/** The npm scripts `expo prebuild` rewrites: 'expo start --android' becomes 'expo run:android'. */
const PREBUILD_REWRITTEN_SCRIPTS = new Set(['ios', 'android']);
/** Gradle's output folder of the app module, inside the app folder. */
const APP_BUILD_DIR = join('android', 'app', 'build');
const WEB_SCHEMES = new Set(['http', 'https']);

function withoutRewrittenScripts(text: string): string {
  const pkg = JSON.parse(text) as { readonly scripts?: Readonly<Record<string, string>> };
  const scripts = Object.entries(pkg.scripts ?? {}).filter(
    ([name]) => !PREBUILD_REWRITTEN_SCRIPTS.has(name),
  );
  return JSON.stringify({ ...pkg, scripts: Object.fromEntries(scripts) });
}

/**
 * True when package.json after the prebuild (`after`) differs from `before` only in the ios and
 * android scripts: the build then writes `before` back, so a smoke build leaves the repo clean.
 */
export function onlyScriptsRewritten(before: string, after: string): boolean {
  return before !== after && withoutRewrittenScripts(before) === withoutRewrittenScripts(after);
}

/**
 * The Release APK for one ABI, with no Gradle or Kotlin daemon left behind on a shared machine (and
 * none that kept another run's environment). The template signs release builds with the debug
 * keystore, so no upload key or password is involved.
 */
export function gradleReleaseArgs(abi: AndroidAbi): string[] {
  return [
    '--no-daemon',
    '--console=plain',
    ':app:assembleRelease',
    `-PreactNativeArchitectures=${abi}`,
    '-Pkotlin.compiler.execution.strategy=out-of-process',
  ];
}

/** Where Gradle writes the release APK, inside the app folder. */
export function builtApkPath(appDir: string): string {
  return join(appDir, APP_BUILD_DIR, 'outputs', 'apk', 'release', 'app-release.apk');
}

/** The merged manifest of the release variant: every library's permissions included. */
export function mergedManifestPath(appDir: string): string {
  const intermediates = join(appDir, APP_BUILD_DIR, 'intermediates');
  return join(
    intermediates,
    'merged_manifests',
    'release',
    'processReleaseManifest',
    'AndroidManifest.xml',
  );
}

/** build/android-emu/app-<variant>.apk: the copy check-apk reads after the run. */
export function keptApkPath(appDir: string, variant: EmuBuildOptions['variant']): string {
  return join(appDir, APK_DIR, `app-${variant}.apk`);
}

/** reports/android-emu/<purpose>-<variant>.png */
export function screenshotPath(options: Pick<EmuBuildOptions, 'purpose' | 'variant'>): string {
  return join(REPORT_DIR, `${options.purpose}-${options.variant}.png`);
}

/** The screenshot taken after --link, next to the launch screenshot. */
export function linkScreenshotPath(options: Pick<EmuBuildOptions, 'purpose' | 'variant'>): string {
  return screenshotPath(options).replace(/\.png$/, '-link.png');
}

/** The app's own URL scheme from a manifest (the first android:scheme that is not http or https). */
export function schemeOf(manifestXml: string): string | null {
  const schemes = [...manifestXml.matchAll(/android:scheme="([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  );
  return schemes.find((scheme) => scheme !== '' && !WEB_SCHEMES.has(scheme)) ?? null;
}

/**
 * `url` quoted for the device's sh: adb shell joins its arguments into one command line, so an
 * unquoted `&` (allowed in --link query strings) would end the am command there.
 */
export function deviceShellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** The VIEW intent for <scheme>://<path>, addressed to the app's package (no chooser can appear). */
export function deepLinkArgs(serial: string, url: string, packageName: string): string[] {
  const intent = [
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    deviceShellQuote(url),
    packageName,
  ];
  return adbArgs(serial, 'shell', ...intent);
}

/** The repo files an npm script runs: every path-like word ending in .ts, .mts, .js or .mjs. */
export function scriptTargetsOf(command: string): string[] {
  return command
    .split(/\s+/)
    .filter((word) => /^[\w@.-]+(\/[\w@.-]+)+\.(ts|mts|js|mjs)$/.test(word));
}

/**
 * The preflight, before the slow and destructive clean prebuild: every npm script the build runs
 * exists and points at files that exist. One line per problem; empty when the build may start.
 */
export function buildScriptProblems(
  scripts: Readonly<Record<string, string>>,
  names: readonly string[],
  exists: (repoPath: string) => boolean,
): string[] {
  return names.flatMap((name) => {
    const command = scripts[name];
    if (command === undefined) {
      return [`package.json has no "${name}" script, and the build runs it after every prebuild`];
    }
    return scriptTargetsOf(command)
      .filter((target) => !exists(target))
      .map((target) => `"${name}" runs ${target}, which does not exist`);
  });
}
