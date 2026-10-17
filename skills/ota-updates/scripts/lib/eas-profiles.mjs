// eas-profiles.mjs: the build profiles of eas.json as EAS resolves them, and the channel each one
// bakes into its binaries (a helper, not an entry point).
//
//   readEasJson(root, rel)            { rel, text, data } or null when the file does not exist
//   resolveProfile(data, name)        the profile with its extends chain applied (env merged)
//   buildEnvironment(profile)         { environment, source }: its own, or EAS Build's default
//   buildTargets(eas)                 [{ profile, line, channel, variant, variantSource, environment, devClient, abstract, isStore }]
//   storeChannels(targets)            Set of channels whose builds go to the stores
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, parseJsonc } from '../check-lib.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readEasJson(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  try {
    const data = parseJsonc(text);
    if (!isObject(data)) throw new Error('the top level is not an object');
    return { rel, text, data };
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, `Fix the syntax of ${rel}.`);
  }
}

export function resolveProfile(data, name, seen = []) {
  const profile = data.build?.[name];
  if (!isObject(profile)) throw new UsageError(`eas.json build profile "${name}" does not exist`, `Fix the extends chain that names "${name}".`);
  if (typeof profile.extends !== 'string') return profile;
  if (seen.includes(name)) throw new UsageError(`eas.json build profiles extend in a cycle (${[...seen, name].join(' -> ')})`, 'Break the extends cycle.');
  const base = resolveProfile(data, profile.extends, [...seen, name]);
  return { ...base, ...profile, env: { ...(base.env ?? {}), ...(profile.env ?? {}) } };
}

const lineOf = (text, needle) => {
  const index = text.indexOf(needle);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
};

/**
 * The EAS environment a build of the profile loads: its own `environment`, else EAS Build's default
 * (docs, "Using environment variables with EAS Build", verified 2026-10-16): production for store
 * distribution, development for a development client, preview for everything else.
 */
export function buildEnvironment(profile) {
  if (typeof profile.environment === 'string') return { environment: profile.environment, source: 'environment' };
  if ((profile.distribution ?? 'store') === 'store') return { environment: 'production', source: 'default' };
  return { environment: profile.developmentClient === true ? 'development' : 'preview', source: 'default' };
}

/**
 * Each build profile with the channel it bakes in and the variant it builds: env.APP_VARIANT when
 * eas.json sets it, else the profile's EAS environment (where the skill keeps APP_VARIANT). A
 * profile that other profiles extend and that names no channel, APP_VARIANT or environment is an
 * abstract base (`abstract: true`): nobody builds it.
 */
export function buildTargets(eas) {
  if (!eas || !isObject(eas.data.build)) return [];
  const names = Object.keys(eas.data.build);
  const extended = new Set(names.map((name) => eas.data.build[name]?.extends).filter((name) => typeof name === 'string'));
  return names.map((name) => {
    const profile = resolveProfile(eas.data, name);
    const devClient = profile.developmentClient === true;
    const channel = typeof profile.channel === 'string' ? profile.channel : null;
    const explicitVariant = typeof profile.env?.APP_VARIANT === 'string' ? profile.env.APP_VARIANT : null;
    const { environment, source } = buildEnvironment(profile);
    return {
      profile: name,
      line: lineOf(eas.text, `"${name}"`),
      channel,
      variant: explicitVariant ?? environment,
      variantSource: explicitVariant !== null ? 'APP_VARIANT' : source,
      environment,
      devClient,
      abstract: extended.has(name) && channel === null && explicitVariant === null && source === 'default',
      isStore: (profile.distribution ?? 'store') === 'store' && !devClient,
    };
  });
}

export function storeChannels(targets) {
  return new Set(targets.filter((target) => target.isStore && !target.abstract && target.channel).map((target) => target.channel));
}
