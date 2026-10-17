// scripts/ios/toolchain.ts
// The pinned iOS toolchain. Selects Xcode by its version (never through xcode-select, which needs
// sudo and switches every build on the Mac) and builds the environment every xcodebuild, xcrun,
// CocoaPods and Expo CLI child process runs with. One canonical copy (owner: ios-simulator-build);
// the release skills ship the same bytes. Changing XCODE_VERSION is a deliberate, reviewed commit.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The one Xcode this repo builds with (verified 2026-10-03: Xcode 26.6, build 17F113). */
export const XCODE_VERSION = '26.6';
/** The simulator runtime that ships with XCODE_VERSION (iOS 26.5, 23F77). */
export const IOS_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
/** Where Xcode installs live; several may coexist (the newest is often the one named Xcode.app). */
export const APPLICATIONS_DIR = '/Applications';

/** One installed Xcode: its .app folder and its CFBundleShortVersionString. */
export type XcodeCandidate = { readonly appPath: string; readonly version: string };

/**
 * The Xcode whose version equals `wanted` exactly, never the one that happens to be named
 * Xcode.app. Throws with what was found and the human step that fixes it.
 */
export function pickXcode(candidates: readonly XcodeCandidate[], wanted: string): XcodeCandidate {
  const match = candidates.find((candidate) => candidate.version === wanted);
  if (match === undefined) {
    const found = candidates.map((c) => `${c.appPath} (${c.version})`).join(', ');
    throw new Error(
      `Xcode ${wanted} is not installed (found: ${found === '' ? 'none' : found}). ` +
        `Human step: install it as ${APPLICATIONS_DIR}/Xcode-${wanted}.app and accept its licence.`,
    );
  }
  return match;
}

/** Throws unless the first line of `xcodebuild -version` is exactly "Xcode <wanted>". */
export function assertXcodeVersion(output: string, wanted: string): void {
  const firstLine = output.split('\n')[0]?.trim() ?? '';
  if (firstLine !== `Xcode ${wanted}`) {
    throw new Error(`xcodebuild -version printed "${firstLine}", expected "Xcode ${wanted}"`);
  }
}

/** The DEVELOPER_DIR of an Xcode .app folder. */
export function developerDirOf(appPath: string): string {
  return join(appPath, 'Contents', 'Developer');
}

/** The DTXcode value a build by `version` carries in its Info.plist: '26.6' -> '2660'. */
export function xcodeBuildNumber(version: string): string {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return `${major}${minor}${patch}`;
}

/**
 * The selected Xcode, no Expo telemetry and no interactive prompts, on top of `base` (process.env;
 * typed as NodeJS.ProcessEnv because child_process takes that type).
 */
export function toolEnv(base: NodeJS.ProcessEnv, developerDir: string): NodeJS.ProcessEnv {
  return { ...base, DEVELOPER_DIR: developerDir, EXPO_NO_TELEMETRY: '1', CI: '1' };
}

function readShortVersion(appPath: string): string {
  const plist = join(appPath, 'Contents', 'Info.plist');
  return execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', plist],
    { encoding: 'utf8' },
  ).trim();
}

/** Every Xcode*.app in `dir` with its version. */
export function listXcodes(dir: string = APPLICATIONS_DIR): XcodeCandidate[] {
  return readdirSync(dir)
    .filter((name) => /^Xcode.*\.app$/.test(name))
    .map((name) => join(dir, name))
    .map((appPath) => ({ appPath, version: readShortVersion(appPath) }));
}

/** Finds XCODE_VERSION, proves it with `xcodebuild -version` and returns the child env. */
export function selectXcode(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const xcode = pickXcode(listXcodes(), XCODE_VERSION);
  const env = toolEnv(base, developerDirOf(xcode.appPath));
  assertXcodeVersion(
    execFileSync('xcodebuild', ['-version'], { encoding: 'utf8', env }),
    XCODE_VERSION,
  );
  return env;
}
