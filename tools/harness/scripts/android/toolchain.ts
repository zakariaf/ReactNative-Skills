// scripts/android/toolchain.ts
// The pinned Android toolchain. Selects JDK 17 and the Android SDK per process (JAVA_HOME and
// ANDROID_HOME on the child environment, never a global switch such as jenv global, sdk default or
// update-alternatives), checks the SDK packages a Release build and an emulator need, and builds the
// environment every Gradle, adb, emulator and Expo CLI child process runs with. Changing a pin is a
// deliberate, reviewed commit (expo-sdk-upgrade moves them with the Expo SDK).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The JDK major Gradle runs on (React Native 0.86's Gradle plugin uses jvmToolchain(17)). */
export const JDK_MAJOR = 17;
/** compileSdk of React Native 0.86.3 (gradle/libs.versions.toml; targetSdk is also 36) and the emulator's API. */
export const ANDROID_API = 36;
/** buildTools of React Native 0.86.3 (verified 2026-10-14). */
export const BUILD_TOOLS_VERSION = '36.0.0';
/** ndkVersion of React Native 0.86.3; Gradle downloads it on the first build when it is missing. */
export const NDK_VERSION = '27.1.12297006';
/** The system image flavour: Google APIs without the Play Store (adb root works, no sign-in prompt). */
export const SYSTEM_IMAGE_TAG = 'google_apis';

/** The two emulator ABIs that run at native speed: Apple silicon and x86_64 hosts. */
export type AndroidAbi = 'arm64-v8a' | 'x86_64';
/** A JDK folder and the text of its `release` file (null when the file is missing). */
export type JdkCandidate = { readonly path: string; readonly release: string | null };
/** The SDK tools this repo runs, by absolute path inside ANDROID_HOME. */
export type SdkTool = 'adb' | 'avdmanager' | 'emulator' | 'sdkmanager';
/** An environment snapshot (process.env, or an object in tests). */
export type EnvSnapshot = Readonly<Record<string, string | undefined>>;
/** The selected toolchain: the child environment and the two folders it names. */
export type Toolchain = {
  readonly env: NodeJS.ProcessEnv;
  readonly javaHome: string;
  readonly androidHome: string;
};

const CMDLINE_TOOLS = join('cmdline-tools', 'latest');
const TOOL_PATHS: Readonly<Record<SdkTool, readonly string[]>> = {
  adb: ['platform-tools', 'adb'],
  avdmanager: [CMDLINE_TOOLS, 'bin', 'avdmanager'],
  emulator: ['emulator', 'emulator'],
  sdkmanager: [CMDLINE_TOOLS, 'bin', 'sdkmanager'],
};
const ANDROID_STUDIO_JBR = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';

/** The emulator ABI for a Node `process.arch`: arm64 hosts run arm64-v8a, everything else x86_64. */
export function hostAbi(arch: string): AndroidAbi {
  return arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
}

/** The sdkmanager package of the pinned system image for `abi`. */
export function systemImageFor(abi: AndroidAbi): string {
  return `system-images;android-${String(ANDROID_API)};${SYSTEM_IMAGE_TAG};${abi}`;
}

/** The JDK major from a `release` file: JAVA_VERSION="17.0.11" -> 17, "1.8.0_402" -> 8. */
export function jdkMajorOf(release: string): number | null {
  const version = /^JAVA_VERSION="([^"]+)"/m.exec(release)?.[1];
  if (version === undefined) return null;
  const [first = '', second = ''] = version.split('.');
  const major = Number(first === '1' ? second : first);
  return Number.isInteger(major) ? major : null;
}

/** The first candidate whose release file says JDK `major`; throws with the human step otherwise. */
export function pickJavaHome(candidates: readonly JdkCandidate[], major: number): string {
  const match = candidates.find(
    (candidate) => candidate.release !== null && jdkMajorOf(candidate.release) === major,
  );
  if (match === undefined) {
    const found = candidates
      .map((c) => `${c.path} (${String(c.release === null ? '?' : jdkMajorOf(c.release))})`)
      .join(', ');
    throw new Error(
      `JDK ${String(major)} not found (looked at: ${found === '' ? 'nothing' : found}). ` +
        `Human step: install a JDK ${String(major)} (Temurin, or Android Studio's bundled JBR) and set JAVA_HOME.`,
    );
  }
  return match.path;
}

/** ANDROID_HOME, else the deprecated ANDROID_SDK_ROOT, else the SDK manager's default folder. */
export function androidHomeOf(env: EnvSnapshot, platform: string, home: string): string {
  const given = env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'];
  if (given !== undefined && given !== '') return given;
  return platform === 'darwin'
    ? join(home, 'Library', 'Android', 'sdk')
    : join(home, 'Android', 'Sdk');
}

/** The SDK folders a Release build and an emulator need, relative to ANDROID_HOME. */
export function requiredSdkPackages(systemImage: string): string[] {
  return [
    'platform-tools',
    'emulator',
    CMDLINE_TOOLS,
    join('platforms', `android-${String(ANDROID_API)}`),
    join('build-tools', BUILD_TOOLS_VERSION),
    join(...systemImage.split(';')),
  ];
}

/** The packages from requiredSdkPackages that `exists` does not find. */
export function missingSdkPackages(
  systemImage: string,
  exists: (relative: string) => boolean,
): string[] {
  return requiredSdkPackages(systemImage).filter((relative) => !exists(relative));
}

/** The absolute path of an SDK tool. */
export function sdkTool(androidHome: string, tool: SdkTool): string {
  return join(androidHome, ...TOOL_PATHS[tool]);
}

/**
 * The selected JDK and SDK, no Expo telemetry and no interactive prompts, on top of `base`
 * (process.env; typed as NodeJS.ProcessEnv because child_process takes that type).
 */
export function toolEnv(
  base: NodeJS.ProcessEnv,
  folders: Pick<Toolchain, 'javaHome' | 'androidHome'>,
): NodeJS.ProcessEnv {
  return {
    ...base,
    JAVA_HOME: folders.javaHome,
    ANDROID_HOME: folders.androidHome,
    EXPO_NO_TELEMETRY: '1',
    CI: '1',
  };
}

function readRelease(path: string): string | null {
  const file = join(path, 'release');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function macJavaHome(major: number): string | null {
  try {
    const args = ['-v', String(major)];
    return execFileSync('/usr/libexec/java_home', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** JAVA_HOME, then (macOS) java_home -v <major> and Android Studio's bundled JBR. */
export function jdkCandidates(base: EnvSnapshot, platform: string): JdkCandidate[] {
  const paths = [base['JAVA_HOME'] ?? ''];
  if (platform === 'darwin') paths.push(macJavaHome(JDK_MAJOR) ?? '', ANDROID_STUDIO_JBR);
  return [...new Set(paths.filter((path) => path !== ''))].map((path) => ({
    path,
    release: readRelease(path),
  }));
}

/** Finds JDK 17 and the SDK, proves the SDK packages exist and returns the child environment. */
export function selectToolchain(base: NodeJS.ProcessEnv, systemImage: string): Toolchain {
  const javaHome = pickJavaHome(jdkCandidates(base, process.platform), JDK_MAJOR);
  const androidHome = androidHomeOf(base, process.platform, homedir());
  const missing = missingSdkPackages(systemImage, (relative) =>
    existsSync(join(androidHome, relative)),
  );
  if (missing.length > 0) {
    throw new Error(
      `the Android SDK in ${androidHome} lacks ${missing.join(', ')}. Human step: install them with ` +
        "the SDK Manager (or sdkmanager '<package>') and accept the licences yourself.",
    );
  }
  return { env: toolEnv(base, { javaHome, androidHome }), javaHome, androidHome };
}
