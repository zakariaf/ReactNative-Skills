// eas-json.mjs: reads eas.json the way EAS CLI does, offline (a helper, not an entry point).
//
//   readEasJson(path, rel)                  { data, text } | null (missing); malformed JSON is bad input
//   schemaProblems(data)                    [{ path, message }]: the checks of @expo/eas-json 24.9.0's Joi schema
//                                           (EAS CLI 24.10.0 refuses such a file with "eas.json is not valid.")
//   resolveBuildProfile(data, name, platform)  { profile } | { error }: extends chain (at most 5 deep), then the
//                                           platform block merged over the common keys, then EAS's defaults
//   resolveSubmitProfile(data, name)        { profile } | { error }: the same extends merge for submit profiles
//   lineOfPath(text, keys)                  1-based line of a key path (["build", "production", "node"]), else of
//                                           the deepest key found, else 1
//
// Mirrors @expo/eas-json 24.9.0 (build/build/schema.js, build/build/resolver.js, build/submit/schema.js),
// the version EAS CLI 24.10.0 depends on. Re-verify: npm pack @expo/eas-json@<version> and diff those files.
import { existsSync, readFileSync } from 'node:fs';

import { UsageError, parseJsonc } from '../check-lib.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** eas.json as { data, text } (comments allowed), null when missing; malformed is bad input. */
export function readEasJson(path, rel) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  let data;
  try {
    data = parseJsonc(text);
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, `Fix the JSON syntax of ${rel}; EAS CLI cannot read it either.`);
  }
  if (!isObject(data)) throw new UsageError(`${rel} is not a JSON object`, `Make ${rel} an object with "cli", "build" and "submit".`);
  return { data, text };
}

// semver.valid() as EAS uses it: x.y.z with an optional pre-release and build, a leading v or = allowed.
const SEMVER = /^[v=]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CHANNEL = /^[a-z\d][a-z\d._-]*$/;
const ENVIRONMENT = /^[a-z0-9_-]+$/;

const str = { kind: 'string' };
const bool = { kind: 'boolean' };
const version = { kind: 'semver' };
const strings = { kind: 'strings' };
const oneOf = (...values) => ({ kind: 'enum', values });
const pattern = (regex, message) => ({ kind: 'pattern', regex, message });

const COMMON_BUILD = {
  resourceClass: oneOf('default', 'medium', 'large'),
  env: { kind: 'env' },
  node: version,
  corepack: bool,
  pnpm: version,
  bun: version,
  yarn: version,
  expoCli: version,
  credentialsSource: oneOf('local', 'remote'),
  distribution: oneOf('store', 'internal'),
  releaseChannel: pattern(CHANNEL, 'fails to match the required pattern'),
  channel: pattern(CHANNEL, 'fails to match the required pattern /^[a-z\\d][a-z\\d._-]*$/'),
  developmentClient: bool,
  prebuildCommand: str,
  autoIncrement: bool,
  buildArtifactPaths: strings,
  uploadSourceMaps: bool,
  cache: { kind: 'object', keys: { disabled: bool, key: str, cacheDefaultPaths: bool, customPaths: strings, paths: strings } },
  config: str,
  withoutCredentials: bool,
  environment: { kind: 'environment' },
};
const PLATFORM_BUILD = { ...COMMON_BUILD, image: str, artifactPath: str, applicationArchivePath: str };
const ANDROID_BUILD = {
  ...PLATFORM_BUILD,
  ndk: version,
  gradleCommand: str,
  buildType: oneOf('apk', 'app-bundle'),
  autoIncrement: oneOf(true, false, 'version', 'versionCode'),
  keystoreName: str,
};
const IOS_BUILD = {
  ...PLATFORM_BUILD,
  resourceClass: oneOf('default', 'medium', 'large', 'm1-medium', 'm-medium', 'm-large'),
  bundler: version,
  fastlane: version,
  cocoapods: version,
  enterpriseProvisioning: oneOf('adhoc', 'universal'),
  simulator: bool,
  scheme: str,
  buildConfiguration: str,
  autoIncrement: oneOf(true, false, 'version', 'buildNumber'),
};
const BUILD_PROFILE = { ...COMMON_BUILD, extends: str, android: { kind: 'object', keys: ANDROID_BUILD }, ios: { kind: 'object', keys: IOS_BUILD } };
const ANDROID_SUBMIT = {
  serviceAccountKeyPath: str,
  track: str,
  releaseStatus: oneOf('completed', 'draft', 'halted', 'inProgress'),
  changesNotSentForReview: bool,
  applicationId: str,
  rollout: { kind: 'fraction' },
};
const IOS_SUBMIT = Object.fromEntries(
  ['ascApiKeyPath', 'ascApiKeyId', 'ascApiKeyIssuerId', 'appleId', 'ascAppId', 'appleTeamId', 'sku', 'language', 'companyName', 'appName', 'bundleIdentifier', 'metadataPath'].map((key) => [key, str]),
);
IOS_SUBMIT.groups = strings;
const SUBMIT_PROFILE = { extends: str, android: { kind: 'object', keys: ANDROID_SUBMIT }, ios: { kind: 'object', keys: IOS_SUBMIT } };
const CLI = {
  version: str,
  requireCommit: bool,
  appVersionSource: oneOf('local', 'remote'),
  promptToConfigurePushNotifications: bool,
  updateAssetHostOverride: str,
  updateManifestHostOverride: str,
};

/** One value against one type; returns a message (Joi's wording where it matters) or null. */
function typeProblem(type, value) {
  switch (type.kind) {
    case 'string':
      return typeof value === 'string' ? null : 'must be a string';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'semver':
      if (value === null) return null;
      return typeof value === 'string' && SEMVER.test(value) ? null : `failed custom validation because ${value} is not a valid version`;
    case 'strings':
      return Array.isArray(value) && value.every((item) => typeof item === 'string') ? null : 'must be an array of strings';
    case 'enum':
      return type.values.includes(value) ? null : `must be one of [${type.values.join(', ')}]`;
    case 'pattern':
      return typeof value === 'string' && type.regex.test(value) ? null : `with value "${value}" ${type.message}`;
    case 'env':
      if (!isObject(value)) return 'must be of type object';
      return Object.values(value).every((item) => item === null || typeof item === 'string') ? null : 'values must be strings';
    case 'environment':
      if (typeof value !== 'string') return 'must be a string';
      if (value.length < 3 || value.length > 100) return 'Environment name must be between 3 and 100 characters.';
      return ENVIRONMENT.test(value) ? null : 'Environment name can only contain lowercase letters, numbers, dashes and underscores.';
    case 'fraction':
      return typeof value === 'number' && value >= 0 && value <= 1 ? null : 'must be a number between 0 and 1';
    default:
      return null;
  }
}

function objectProblems(object, keys, path, out) {
  if (!isObject(object)) {
    out.push({ path, message: 'must be of type object' });
    return;
  }
  for (const [key, value] of Object.entries(object)) {
    const type = keys[key];
    const at = [...path, key];
    if (type === undefined) out.push({ path: at, message: 'is not allowed' });
    else if (type.kind === 'object') objectProblems(value, type.keys, at, out);
    else {
      const message = typeProblem(type, value);
      if (message) out.push({ path: at, message });
    }
  }
}

function crossFieldProblems(data, out) {
  for (const [name, profile] of Object.entries(isObject(data.build) ? data.build : {})) {
    for (const platform of ['android', 'ios']) {
      const block = profile?.[platform];
      if (isObject(block) && block.artifactPath !== undefined && block.applicationArchivePath !== undefined) {
        out.push({ path: ['build', name, platform], message: 'contains a conflict between optional exclusive peers [artifactPath, applicationArchivePath]' });
      }
    }
  }
  for (const [name, profile] of Object.entries(isObject(data.submit) ? data.submit : {})) {
    const android = profile?.android;
    if (!isObject(android)) continue;
    if (android.releaseStatus === 'inProgress' && android.rollout === undefined) out.push({ path: ['submit', name, 'android', 'rollout'], message: 'is required' });
    if (android.releaseStatus !== 'inProgress' && android.rollout !== undefined) out.push({ path: ['submit', name, 'android', 'rollout'], message: 'is not allowed' });
  }
}

/** Every key, type, enum and pattern problem EAS CLI's schema would report, offline. */
export function schemaProblems(data) {
  const out = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === '$schema') continue;
    if (key === 'cli') objectProblems(value, CLI, ['cli'], out);
    else if (key === 'build' || key === 'submit') {
      if (!isObject(value)) {
        out.push({ path: [key], message: 'must be of type object' });
        continue;
      }
      for (const [name, profile] of Object.entries(value)) objectProblems(profile, key === 'build' ? BUILD_PROFILE : SUBMIT_PROFILE, [key, name], out);
    } else out.push({ path: [key], message: 'is not allowed' });
  }
  crossFieldProblems(data, out);
  return out;
}

/** EAS's mergeProfiles: update wins, env and the platform blocks merge one level. */
function mergeProfiles(base, update) {
  const result = { ...base, ...update };
  if (isObject(base.env) && isObject(update.env)) result.env = { ...base.env, ...update.env };
  for (const platform of ['android', 'ios']) {
    if (isObject(base[platform]) && isObject(update[platform])) result[platform] = mergeProfiles(base[platform], update[platform]);
  }
  return result;
}

function resolveChain(section, kind, name, depth = 0) {
  if (depth >= 5) return { error: `Too long chain of profile extensions at "${name}", make sure "extends" keys do not make a cycle` };
  const profile = section?.[name];
  if (!isObject(profile)) {
    return { error: depth === 0 ? `Missing ${kind} profile in eas.json: "${name}"` : `Extending non-existent ${kind} profile in eas.json: "${name}"` };
  }
  const { extends: parent, ...rest } = profile;
  if (typeof parent !== 'string' || parent === '') return { profile: rest };
  const base = resolveChain(section, kind, parent, depth + 1);
  return base.error ? base : { profile: mergeProfiles(base.profile, rest) };
}

const BUILD_DEFAULTS = { credentialsSource: 'remote', distribution: 'store' };

/** The build profile EAS CLI would use for one platform (extends, platform block, defaults). */
export function resolveBuildProfile(data, name, platform) {
  const chain = resolveChain(data.build, 'build', name);
  if (chain.error) return chain;
  const { android, ios, ...base } = chain.profile;
  const blocks = { android, ios };
  const merged = mergeProfiles(base, isObject(blocks[platform]) ? blocks[platform] : {});
  return { profile: mergeProfiles(BUILD_DEFAULTS, merged), raw: chain.profile };
}

/** The submit profile after its extends chain (no platform merge: submit keys live in their block). */
export function resolveSubmitProfile(data, name) {
  return resolveChain(data.submit, 'submit', name);
}

/** 1-based line of a key path in a JSON text, following each key from the previous one's position. */
export function lineOfPath(text, keys) {
  let from = 0;
  let found = -1;
  for (const key of keys) {
    const index = text.indexOf(`"${key}"`, from);
    if (index < 0) break;
    found = index;
    from = index + key.length + 2;
  }
  return found < 0 ? 1 : text.slice(0, found).split('\n').length;
}
