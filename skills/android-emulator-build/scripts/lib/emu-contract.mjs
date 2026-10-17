// emu-contract.mjs: reads the repo facts the checkers of this skill share (a helper, not an entry
// point): contracts/android-emu-build.json (validated key by key), the toolchain pins in
// scripts/android/toolchain.ts, the installed React Native version catalog, the AVD prefix and
// package.json.
//
//   CONTRACT_NAME                    'android-emu-build.json' (inside layout.contractsDir)
//   readJsonFile(root, rel)          parsed JSON or null when absent; UsageError when malformed
//   readEmuContract(root, layout)    { rel, exists, data, problems: [{ line, message, fix }] }
//   avdPrefix(data, pkg)             contract avdPrefix, else the package name in kebab case
//   readToolchainPin(root, layout)   { rel, text, jdk, api, buildTools } (null for a value not pinned as a literal)
//   readRnCatalog(root, appDir)      { rel, compileSdk, targetSdk, buildTools } from node_modules/react-native/gradle/libs.versions.toml, or null
//   readRnJvmToolchain(root, appDir) { rel, jdk } the jvmToolchain(<n>) of node_modules/@react-native/gradle-plugin, or null
//   dependsOn(pkgs, name)            true when any of the package.json objects depends on name
//   sdkMajor(pkg)                    the Expo SDK major from the expo specifier, or null
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError } from '../check-lib.mjs';

export const CONTRACT_NAME = 'android-emu-build.json';
/** The verified pins of this skill (Expo SDK 57, React Native 0.86.3; verified 2026-10-14). */
export const PINNED = Object.freeze({ jdk: 17, api: 36, buildTools: '36.0.0', minSdk: 24 });

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ANDROID_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const PERMISSION = /^(?:\$\{applicationId\}(?:\.[A-Za-z]\w*)*|[A-Za-z][\w.]*)\.[A-Z_0-9]+$/;
const SYSTEM_IMAGE = /^system-images;android-\d+;[\w-]+;(arm64-v8a|x86_64)$/;
const TOKEN = /__[A-Z][A-Z0-9_]*__/;

const isNonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const isNames = (value, pattern = /\S/) => Array.isArray(value) && value.every((item) => typeof item === 'string' && pattern.test(item)) && new Set(value).size === value.length;
const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value);
const isLevel = (value) => Number.isInteger(value) && value >= PINNED.minSdk;

/** Each key: [check(value) -> true when valid, what a valid value is]. */
const KEYS = {
  $schema: [isNonEmpty, 'a string'],
  $comment: [isNonEmpty, 'a string'],
  avdPrefix: [(value) => typeof value === 'string' && KEBAB.test(value), 'a kebab-case prefix such as "tasks"'],
  device: [isNonEmpty, 'an avdmanager hardware profile such as "pixel_8"'],
  systemImage: [(value) => typeof value === 'string' && SYSTEM_IMAGE.test(value), 'a system image such as "system-images;android-36;google_apis;arm64-v8a"'],
  appId: [(value) => typeof value === 'string' && ANDROID_ID.test(value), 'an Android package such as "com.acme.tasks"'],
  postPrebuild: [(value) => isNames(value), 'a list of npm script names without duplicates'],
  targetSdk: [isLevel, `an API level of ${PINNED.minSdk} or higher, such as 36`],
  minSdk: [isLevel, `an API level of ${PINNED.minSdk} or higher`],
  permissions: [(value) => isNames(value, PERMISSION), 'a list of permission names such as "android.permission.INTERNET" (or "${applicationId}.NAME" for one named after the app\'s package), without duplicates'],
  application: [(value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isScalar), 'an object of <application> attributes (no android: prefix) to string, number or boolean values'],
  abi: [(value) => value === 'arm64-v8a' || value === 'x86_64', '"arm64-v8a" or "x86_64"'],
  readyLog: [(value) => value === null || (typeof value === 'object' && !Array.isArray(value) && isNonEmpty(value.tag) && isNonEmpty(value.contains) && Object.keys(value).every((key) => ['tag', 'contains'].includes(key))), 'null or { "tag": "<logcat tag>", "contains": "<text>" }'],
};

/** Parsed JSON of a repo file, or null when it does not exist. A malformed file is bad input. */
export function readJsonFile(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON (${error.message})`, `Fix the JSON in ${rel}.`);
  }
}

function lineOfKey(text, key) {
  const index = text.indexOf(`"${key}"`);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
}

function tokensIn(value) {
  if (typeof value === 'string') return TOKEN.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(tokensIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(tokensIn);
  return [];
}

/** The contract with every valid key in `data` (an invalid key is left out and reported), or data {} when absent. */
export function readEmuContract(root, layout) {
  const rel = posix.join(layout.contractsDir, CONTRACT_NAME);
  const raw = readJsonFile(root, rel);
  if (raw === null) return { rel, exists: false, data: {}, problems: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(`${rel} is not a JSON object`, "Start from the skill's templates/contracts/android-emu-build.json.");
  const text = readFileSync(join(root, rel), 'utf8');
  const data = {};
  const problems = [];
  for (const [key, value] of Object.entries(raw)) {
    const rule = KEYS[key];
    const line = lineOfKey(text, key);
    if (rule === undefined) problems.push({ line, message: `unknown key "${key}"`, fix: `Remove it; the keys are ${Object.keys(KEYS).filter((name) => !name.startsWith('$')).join(', ')} (templates/contracts/android-emu-build.schema.json).` });
    else if (tokensIn(value).length > 0) problems.push({ line, message: `"${key}" still holds the template placeholder ${tokensIn(value)[0]}`, fix: `Replace it with the app's value (or remove "${key}" to use the default).` });
    else if (!rule[0](value)) problems.push({ line, message: `"${key}" is ${JSON.stringify(value)}, not ${rule[1]}`, fix: `Set "${key}" to ${rule[1]}, or remove it to use the default.` });
    else data[key] = value;
  }
  if (data.minSdk !== undefined && data.targetSdk !== undefined && data.minSdk > data.targetSdk) problems.push({ line: lineOfKey(text, 'minSdk'), message: `"minSdk" ${data.minSdk} is above "targetSdk" ${data.targetSdk}`, fix: 'Lower minSdk or raise targetSdk: a minSdk above the targetSdk fails the Gradle build.' });
  return { rel, exists: true, data, problems };
}

/** The AVD prefix: the contract's, else the package name in kebab case ('' when neither). */
export function avdPrefix(data, pkg) {
  if (typeof data.avdPrefix === 'string') return data.avdPrefix;
  const bare = String(pkg?.name ?? '').split('/').at(-1) ?? '';
  return bare.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The pins of scripts/android/toolchain.ts as written (null for a value that is not a literal). */
export function readToolchainPin(root, layout) {
  const rel = posix.join(layout.scriptsDir, 'android', 'toolchain.ts');
  const path = join(root, rel);
  if (!existsSync(path)) return { rel, text: null, jdk: null, api: null, buildTools: null };
  const text = readFileSync(path, 'utf8');
  const int = (name) => {
    const match = new RegExp(String.raw`export\s+const\s+${name}\s*=\s*(\d+)\s*;`).exec(text);
    return match ? Number(match[1]) : null;
  };
  const buildTools = /export\s+const\s+BUILD_TOOLS_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/.exec(text)?.[1] ?? null;
  return { rel, text, jdk: int('JDK_MAJOR'), api: int('ANDROID_API'), buildTools };
}

/** compileSdk, targetSdk and buildTools of the installed React Native (the versions Gradle builds with), or null. */
export function readRnCatalog(root, appDir = '.') {
  for (const dir of [...new Set([appDir, '.'])]) {
    const path = join(root, dir, 'node_modules', 'react-native', 'gradle', 'libs.versions.toml');
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const value = (key) => new RegExp(String.raw`^${key}\s*=\s*"([^"]+)"`, 'm').exec(text)?.[1] ?? null;
    return { rel: posix.join(dir, 'node_modules/react-native/gradle/libs.versions.toml'), compileSdk: value('compileSdk'), targetSdk: value('targetSdk'), buildTools: value('buildTools') };
  }
  return null;
}

const GRADLE_PLUGIN_BUILDS = ['react-native-gradle-plugin/build.gradle.kts', 'settings-plugin/build.gradle.kts', 'shared/build.gradle.kts', 'build.gradle.kts'];

/** The JDK React Native's Gradle plugin compiles with (kotlin { jvmToolchain(<n>) }), or null when not installed or not stated. */
export function readRnJvmToolchain(root, appDir = '.') {
  for (const dir of [...new Set([appDir, '.'])]) {
    const plugin = posix.join(dir, 'node_modules/@react-native/gradle-plugin');
    if (!existsSync(join(root, plugin))) continue;
    for (const file of GRADLE_PLUGIN_BUILDS) {
      const path = join(root, plugin, file);
      if (!existsSync(path)) continue;
      const match = /\bjvmToolchain\s*\(\s*(\d+)\s*\)/.exec(readFileSync(path, 'utf8'));
      if (match) return { rel: posix.join(plugin, file), jdk: Number(match[1]) };
    }
    return null;
  }
  return null;
}

/** A dependency (or devDependency) of any of the package.json objects. */
export function dependsOn(pkgs, name) {
  return pkgs.some((pkg) => pkg?.dependencies?.[name] !== undefined || pkg?.devDependencies?.[name] !== undefined);
}

/** The Expo SDK major: '~57.0.26' -> 57; null without an expo dependency or with a tag. */
export function sdkMajor(pkg) {
  const spec = pkg?.dependencies?.expo ?? pkg?.devDependencies?.expo;
  const match = /(\d+)\./.exec(typeof spec === 'string' ? spec : '');
  return match ? Number(match[1]) : null;
}
