// sim-contract.mjs: reads the repo facts both checkers of this skill share (a helper, not an entry
// point): contracts/ios-sim-build.json (validated key by key, defaults applied), the Xcode pin in
// scripts/ios/toolchain.ts, the simulator prefix, and package.json.
//
//   CONTRACT_NAME                       'ios-sim-build.json' (inside layout.contractsDir)
//   readJsonFile(root, rel)             parsed JSON or null when absent; UsageError when malformed
//   readSimContract(root, layout)       { rel, exists, data, problems: [{ line, message, fix }] }
//   simulatorPrefix(data, pkg)          contract simulatorPrefix, else the package name in kebab case
//   readXcodePin(root, layout)          { rel, text, version, major } (version as written,
//                                       '<major>.<minor>[.<patch>]'; text null when absent)
//   xcodeBuildNumber(version)           the DTXcode an Xcode writes: '26.6' -> '2660', '26.6.1' -> '2661'
//   dependencyVersion(pkg, name)        the specifier in dependencies/devDependencies, or null
//   sdkMajor(pkg)                       the Expo SDK major from the expo specifier, or null
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError } from '../check-lib.mjs';

export const CONTRACT_NAME = 'ios-sim-build.json';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const TOKEN = /__[A-Z][A-Z0-9_]*__/;

const isNonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const isNames = (value, pattern = /\S/) => Array.isArray(value) && value.every((item) => typeof item === 'string' && pattern.test(item)) && new Set(value).size === value.length;
const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value);

/** Each key: [check(value) -> true when valid, what a valid value is]. */
const KEYS = {
  $schema: [isNonEmpty, 'a string'],
  $comment: [isNonEmpty, 'a string'],
  simulatorPrefix: [(value) => typeof value === 'string' && KEBAB.test(value), 'a kebab-case prefix such as "tasks"'],
  deviceType: [isNonEmpty, 'a simulator model such as "iPhone 17 Pro Max"'],
  appId: [(value) => typeof value === 'string' && BUNDLE_ID.test(value), 'a reverse-DNS bundle id such as "com.acme.tasks"'],
  postPrebuild: [(value) => isNames(value), 'a list of npm script names without duplicates'],
  usageStrings: [(value) => isNames(value, /^NS[A-Za-z]+UsageDescription$/), 'a list of NS*UsageDescription keys without duplicates'],
  infoPlist: [(value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isScalar), 'an object of Info.plist keys to string, number or boolean values'],
  deploymentTarget: [(value) => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value), 'a version such as "18.6" or a major alone such as "26" (the app config ios.deploymentTarget format)'],
  usesNonExemptEncryption: [(value) => typeof value === 'boolean', 'true or false'],
  readyMarker: [(value) => value === null || (typeof value === 'object' && !Array.isArray(value) && isNonEmpty(value.file) && isNonEmpty(value.contains) && Object.keys(value).every((key) => ['file', 'contains'].includes(key))), 'null or { "file": "<path in the data container>", "contains": "<text>" }'],
  linkFlow: [isNonEmpty, 'the path of a Maestro sub-flow'],
  maestroBin: [isNonEmpty, 'the Maestro binary to run'],
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

/**
 * The contract with every valid key in `data` (an invalid key is left out and reported), or
 * data {} when the file does not exist (every key is optional).
 */
export function readSimContract(root, layout) {
  const rel = posix.join(layout.contractsDir, CONTRACT_NAME);
  const raw = readJsonFile(root, rel);
  if (raw === null) return { rel, exists: false, data: {}, problems: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(`${rel} is not a JSON object`, 'Start from the skill\'s templates/contracts/ios-sim-build.json.');
  const text = readFileSync(join(root, rel), 'utf8');
  const data = {};
  const problems = [];
  for (const [key, value] of Object.entries(raw)) {
    const rule = KEYS[key];
    const line = lineOfKey(text, key);
    if (rule === undefined) {
      problems.push({ line, message: `unknown key "${key}"`, fix: `Remove it; the keys are ${Object.keys(KEYS).filter((name) => !name.startsWith('$')).join(', ')} (templates/contracts/ios-sim-build.schema.json).` });
    } else if (tokensIn(value).length > 0) {
      problems.push({ line, message: `"${key}" still holds the template placeholder ${tokensIn(value)[0]}`, fix: `Replace it with the app's value (or remove "${key}" to use the default).` });
    } else if (!rule[0](value)) {
      problems.push({ line, message: `"${key}" is ${JSON.stringify(value)}, not ${rule[1]}`, fix: `Set "${key}" to ${rule[1]}, or remove it to use the default.` });
    } else {
      data[key] = value;
    }
  }
  return { rel, exists: true, data, problems };
}

/** The simulator prefix: the contract's, else the package name in kebab case ('' when neither). */
export function simulatorPrefix(data, pkg) {
  if (typeof data.simulatorPrefix === 'string') return data.simulatorPrefix;
  const bare = String(pkg?.name ?? '').split('/').at(-1) ?? '';
  return bare.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The Xcode pin: scripts/ios/toolchain.ts XCODE_VERSION = '<major>.<minor>[.<patch>]', kept as
 * written (a patch release such as 26.0.1 writes its own DTXcode, and pickXcode needs the patch).
 */
export function readXcodePin(root, layout) {
  const rel = posix.join(layout.scriptsDir, 'ios', 'toolchain.ts');
  const path = join(root, rel);
  if (!existsSync(path)) return { rel, text: null, version: null, major: null };
  const text = readFileSync(path, 'utf8');
  const match = /export\s+const\s+XCODE_VERSION\s*=\s*'(\d+\.\d+(?:\.\d+)?)'/.exec(text);
  return { rel, text, version: match ? match[1] : null, major: match ? Number(match[1].split('.')[0]) : null, index: match?.index ?? 0 };
}

/** The DTXcode a given Xcode writes, built like toolchain.ts xcodeBuildNumber: major + minor + (patch or 0). */
export function xcodeBuildNumber(version) {
  const [major = '0', minor = '0', patch = '0'] = String(version).split('.');
  return `${major}${minor}${patch}`;
}

/** The specifier of `name` in dependencies or devDependencies, or null. */
export function dependencyVersion(pkg, name) {
  const spec = pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name];
  return typeof spec === 'string' ? spec : null;
}

/** The Expo SDK major: '~57.0.26' -> 57; null without an expo dependency or with a tag. */
export function sdkMajor(pkg) {
  const match = /(\d+)\./.exec(dependencyVersion(pkg, 'expo') ?? '');
  return match ? Number(match[1]) : null;
}
